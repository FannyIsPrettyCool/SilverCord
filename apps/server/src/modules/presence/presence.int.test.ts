import { randomUUID } from 'node:crypto';
import {
  channelSchema,
  GatewayOp,
  type PresenceStatus,
  presenceSnapshotSchema,
  typingSnapshotSchema,
} from '@silvercord/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, expectError, openRegistration, register } from '../../../test/auth-helpers.ts';
import { TestGatewayClient } from '../../../test/gateway-client.ts';
import { createTestApp, type TestApp } from '../../../test/test-app.ts';
import { createValkey } from '../../infra/valkey.ts';
import { createPresenceLeases, LEASE_TTL_MS } from './presence-leases.ts';

type Account = Awaited<ReturnType<typeof register>>;
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('presence and typing', () => {
  let t: TestApp;
  let baseUrl: string;
  beforeAll(async () => {
    t = await createTestApp({
      presence: { offlineDebounceMs: 150, coalesceMs: 50, sweepMs: 60_000 },
    });
    await openRegistration(t);
    baseUrl = await t.app.listen({ host: '127.0.0.1', port: 0 });
  });
  afterAll(() => t.close());

  const id = (account: Account) => account.tokens.user.id;
  const call = (
    actor: Account,
    method: Method,
    url: string,
    payload?: unknown,
    headers: Record<string, string> = {},
  ) =>
    t.request({
      method,
      url: `/api/v1${url}`,
      headers: { ...bearer(actor.tokens), ...headers },
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  async function befriend(a: Account, b: Account) {
    await call(a, 'POST', '/users/@me/relationships', { username: b.account.username });
    expect((await call(b, 'PUT', `/users/@me/relationships/${id(a)}/accept`, {})).statusCode).toBe(
      200,
    );
  }
  async function connect(account: Account) {
    const client = await TestGatewayClient.connect(baseUrl);
    await client.next((frame) => frame.op === GatewayOp.HELLO);
    client.identify(account.tokens.accessToken);
    await client.dispatch('READY');
    return client;
  }
  async function statusOf(viewer: Account, subject: Account): Promise<PresenceStatus> {
    const response = await call(viewer, 'GET', `/presence?userIds=${id(subject)}`);
    expect(response.statusCode, response.body).toBe(200);
    return presenceSnapshotSchema.parse(response.json()).items[0]?.status ?? 'offline';
  }
  async function eventually(check: () => Promise<boolean>, timeoutMs = 3000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await check()) return;
      await wait(25);
    }
    throw new Error('condition not reached');
  }

  describe('presence', () => {
    it('shows friends online while a socket is attached and honors preferences', async () => {
      const a = await register(t);
      const b = await register(t);
      await befriend(a, b);
      expect(await statusOf(b, a)).toBe('offline');
      const socket = await connect(a);
      await eventually(async () => (await statusOf(b, a)) === 'online');
      expect((await call(a, 'PATCH', '/users/@me/presence', { status: 'dnd' })).statusCode).toBe(
        200,
      );
      expect(await statusOf(b, a)).toBe('dnd');
      await call(a, 'PATCH', '/users/@me/presence', { status: 'invisible' });
      expect(await statusOf(b, a)).toBe('offline');
      expect((await call(a, 'GET', '/users/@me/presence')).json()).toEqual({ status: 'invisible' });
      await call(a, 'PATCH', '/users/@me/presence', { status: 'online' });
      await socket.close();
      await eventually(async () => (await statusOf(b, a)) === 'offline');
    });

    it('aggregates devices: one disconnect leaves the user online', async () => {
      const a = await register(t);
      const b = await register(t);
      await befriend(a, b);
      const first = await connect(a);
      const second = await connect(a);
      await eventually(async () => (await statusOf(b, a)) === 'online');
      await first.close();
      await wait(300);
      expect(await statusOf(b, a)).toBe('online');
      await second.close();
      await eventually(async () => (await statusOf(b, a)) === 'offline');
    });

    it('reveals nothing to strangers or across a block', async () => {
      const a = await register(t);
      const friend = await register(t);
      const stranger = await register(t);
      await befriend(a, friend);
      const socket = await connect(a);
      await eventually(async () => (await statusOf(friend, a)) === 'online');
      expect(await statusOf(stranger, a)).toBe('offline');
      await call(friend, 'PUT', `/users/@me/blocks/${id(a)}`, {});
      expect(await statusOf(friend, a)).toBe('offline');
      const unknown = presenceSnapshotSchema.parse(
        (await call(stranger, 'GET', '/presence?userIds=999999999999')).json(),
      );
      expect(unknown.items).toEqual([
        { userId: '999999999999', status: 'offline', observedAt: expect.any(String) },
      ]);
      await socket.close();
    });

    it('sends content-free presence invalidations to friends over the gateway', async () => {
      const a = await register(t);
      const b = await register(t);
      await befriend(a, b);
      const watcher = await connect(b);
      const socket = await connect(a);
      // The watcher's own connection invalidates itself first; wait for the friend's event.
      const event = await watcher.next(
        (frame) =>
          frame.t === 'PRESENCE_CHANGED' &&
          JSON.stringify(frame.d) === JSON.stringify({ userId: id(a) }),
      );
      expect(Object.keys(event.d as object)).toEqual(['userId']);
      await socket.close();
      await watcher.close();
    });

    it('validates presence queries', async () => {
      const a = await register(t);
      expectError(await call(a, 'GET', '/presence'), 400, 'VALIDATION_FAILED');
      expectError(await call(a, 'GET', '/presence?userIds=1,1'), 400, 'VALIDATION_FAILED');
      const many = Array.from({ length: 101 }, (_, index) => index + 1).join(',');
      expectError(await call(a, 'GET', `/presence?userIds=${many}`), 400, 'VALIDATION_FAILED');
      expectError(
        await call(a, 'PATCH', '/users/@me/presence', { status: 'offline' }),
        400,
        'VALIDATION_FAILED',
      );
    });
  });

  describe('leases', () => {
    it('never revives a released lease and sweeps expired ones', async () => {
      const valkey = createValkey(t.context.env.VALKEY_URL);
      let clock = 1_000_000;
      const leases = createPresenceLeases(t.context.valkey, () => clock);
      const user = BigInt(Date.now()) * 1000n + 7n;
      expect(await leases.attach(user, 'gw-1')).toBe(true);
      expect(await leases.attach(user, 'gw-2')).toBe(false);
      expect(await leases.release(user, 'gw-1')).toBe(false);
      await leases.refresh(user, 'gw-1');
      expect(await leases.liveCount(user)).toBe(1);
      clock += LEASE_TTL_MS + 1;
      expect(await leases.sweep()).toContain(user);
      expect(await leases.live([user])).toEqual(new Set());
      valkey.disconnect();
    });
  });

  describe('typing', () => {
    async function dm() {
      const a = await register(t);
      const b = await register(t);
      await befriend(a, b);
      const channel = channelSchema.parse(
        (await call(a, 'POST', '/users/@me/channels', { recipientId: id(b) })).json(),
      );
      return { a, b, channelId: channel.id };
    }
    const typingOf = async (viewer: Account, channelId: string) =>
      typingSnapshotSchema.parse(
        (await call(viewer, 'GET', `/channels/${channelId}/typing`)).json(),
      ).items;

    it('shows peers typing, excludes self and clears on stop and send', async () => {
      const { a, b, channelId } = await dm();
      expect(
        (await call(a, 'PUT', `/channels/${channelId}/typing`, { active: true })).statusCode,
      ).toBe(204);
      expect((await typingOf(b, channelId)).map((item) => item.userId)).toEqual([id(a)]);
      expect(await typingOf(a, channelId)).toEqual([]);
      await call(a, 'PUT', `/channels/${channelId}/typing`, { active: false });
      expect(await typingOf(b, channelId)).toEqual([]);
      await call(a, 'PUT', `/channels/${channelId}/typing`, { active: true });
      await call(
        a,
        'POST',
        `/channels/${channelId}/messages`,
        { content: 'sent' },
        {
          'idempotency-key': randomUUID(),
        },
      );
      expect(await typingOf(b, channelId)).toEqual([]);
    });

    it('denies outsiders and blocked peers', async () => {
      const { a, b, channelId } = await dm();
      const outsider = await register(t);
      expectError(
        await call(outsider, 'PUT', `/channels/${channelId}/typing`, { active: true }),
        404,
        'NOT_FOUND',
      );
      expectError(await call(outsider, 'GET', `/channels/${channelId}/typing`), 404, 'NOT_FOUND');
      await call(a, 'PUT', `/channels/${channelId}/typing`, { active: true });
      await call(b, 'PUT', `/users/@me/blocks/${id(a)}`, {});
      expect(await typingOf(b, channelId)).toEqual([]);
      expectError(
        await call(a, 'PUT', `/channels/${channelId}/typing`, { active: true }),
        403,
        'FORBIDDEN',
      );
    });

    it('notifies channel members with content-free typing invalidations', async () => {
      const { a, b, channelId } = await dm();
      const watcher = await connect(b);
      await call(a, 'PUT', `/channels/${channelId}/typing`, { active: true });
      expect((await watcher.dispatch('TYPING_CHANGED')).d).toEqual({ channelId });
      await watcher.close();
    });
  });
});
