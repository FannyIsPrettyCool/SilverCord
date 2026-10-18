import {
  GatewayOp,
  ownActivitySchema,
  ownProfileSchema,
  userProfileSchema,
  userSummariesSchema,
} from '@silvercord/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, expectError, openRegistration, register } from '../../../test/auth-helpers.ts';
import { TestGatewayClient } from '../../../test/gateway-client.ts';
import { createTestApp, type TestApp } from '../../../test/test-app.ts';

type Account = Awaited<ReturnType<typeof register>>;
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('activity', () => {
  let t: TestApp;
  let baseUrl: string;
  beforeAll(async () => {
    t = await createTestApp({
      presence: { offlineDebounceMs: 100, coalesceMs: 30, sweepMs: 60_000 },
    });
    await openRegistration(t);
    baseUrl = await t.app.listen({ host: '127.0.0.1', port: 0 });
  });
  afterAll(() => t.close());

  const id = (account: Account) => account.tokens.user.id;
  const call = (actor: Account, method: Method, url: string, payload?: unknown) =>
    t.request({
      method,
      url: `/api/v1${url}`,
      headers: bearer(actor.tokens),
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  const sources = (actor: Account, value: Record<string, boolean>) =>
    call(actor, 'PUT', '/users/@me/activity/sources', {
      manual: false,
      game: false,
      rpc: false,
      media: false,
      ...value,
    });
  async function befriend(a: Account, b: Account) {
    await call(a, 'POST', '/users/@me/relationships', { username: b.account.username });
    await call(b, 'PUT', `/users/@me/relationships/${id(a)}/accept`, {});
  }
  async function online(account: Account) {
    const client = await TestGatewayClient.connect(baseUrl);
    await client.next((frame) => frame.op === GatewayOp.HELLO);
    client.identify(account.tokens.accessToken);
    await client.dispatch('READY');
    return client;
  }
  async function eventually(check: () => Promise<boolean>, timeoutMs = 4000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await check()) return;
      await wait(25);
    }
    throw new Error('condition not reached');
  }
  const game = { activity: { type: 'playing', name: 'Starfield Run', details: 'Sector 7' } };

  it('refuses every source until it is turned on and forgets it when turned off', async () => {
    const owner = await register(t);
    expectError(await call(owner, 'PUT', '/users/@me/activity/game', game), 403, 'FORBIDDEN');
    expect((await sources(owner, { game: true, manual: true })).statusCode).toBe(200);
    expect((await call(owner, 'PUT', '/users/@me/activity/game', game)).statusCode).toBe(204);
    expect(
      (
        await call(owner, 'PUT', '/users/@me/activity/manual', {
          activity: { type: 'listening', name: 'Lo-fi radio' },
          expiresAt: null,
        })
      ).statusCode,
    ).toBe(204);
    let own = ownActivitySchema.parse((await call(owner, 'GET', '/users/@me/activity')).json());
    expect(own.activities.map((activity) => activity.source)).toEqual(['game', 'manual']);
    expect(own.activities[0]).toMatchObject({ name: 'Starfield Run', buttons: [] });

    await sources(owner, { manual: true });
    own = ownActivitySchema.parse((await call(owner, 'GET', '/users/@me/activity')).json());
    expect(own.activities.map((activity) => activity.source)).toEqual(['manual']);
    await sources(owner, {});
    own = ownActivitySchema.parse((await call(owner, 'GET', '/users/@me/activity')).json());
    expect(own).toMatchObject({ manual: null, activities: [] });
  });

  it('shows activity only to the audience and only while the owner looks online', async () => {
    const owner = await register(t);
    const friend = await register(t);
    const stranger = await register(t);
    await befriend(owner, friend);
    await sources(owner, { rpc: true });
    await call(owner, 'PUT', '/users/@me/activity/rpc', {
      activity: {
        type: 'playing',
        name: 'Tetrominoes',
        application: 'Blocks',
        buttons: [{ label: 'Watch', url: 'https://example.org/live' }],
      },
    });
    const view = async (viewer: Account) =>
      userProfileSchema.parse((await call(viewer, 'GET', `/users/${id(owner)}/profile`)).json());
    expect((await view(friend)).activities).toBeUndefined();
    const socket = await online(owner);
    await eventually(async () => (await view(friend)).activities?.[0]?.name === 'Tetrominoes');
    expect((await view(friend)).activities?.[0]?.buttons).toHaveLength(1);
    // Friends-only presence (presence.md) keeps strangers from seeing it.
    expect((await view(stranger)).activities).toBeUndefined();
    const summary = userSummariesSchema.parse(
      (await call(friend, 'GET', `/users/summaries?userIds=${id(owner)}`)).json(),
    ).items[0];
    expect(summary?.activity?.application).toBe('Blocks');

    const privacy = ownProfileSchema.parse(
      (await call(owner, 'GET', '/users/@me/profile')).json(),
    ).privacy;
    await call(owner, 'PUT', '/users/@me/profile/privacy', { ...privacy, activity: 'only_me' });
    expect((await view(friend)).activities).toBeUndefined();
    await call(owner, 'PUT', '/users/@me/profile/privacy', { ...privacy, activity: 'friends' });
    await call(owner, 'PATCH', '/users/@me/presence', { status: 'invisible' });
    expect((await view(friend)).activities).toBeUndefined();
    socket.close();
  });

  it('drops detected activity that stopped being refreshed and rejects unsafe input', async () => {
    const owner = await register(t);
    await sources(owner, { media: true });
    await call(owner, 'PUT', '/users/@me/activity/media', {
      activity: { type: 'listening', name: 'Song', state: 'Artist' },
    });
    const field = (await t.context.valkey.hkeys(`activity:${id(owner)}`))[0];
    if (!field) throw new Error('no entry');
    await t.context.valkey.hset(
      `activity:${id(owner)}`,
      field,
      JSON.stringify({ a: { type: 'listening', name: 'Song' }, at: Date.now() - 200_000 }),
    );
    const own = ownActivitySchema.parse((await call(owner, 'GET', '/users/@me/activity')).json());
    expect(own.activities).toEqual([]);
    expect(await t.context.valkey.hlen(`activity:${id(owner)}`)).toBe(0);

    for (const activity of [
      { type: 'playing', name: 'x‮y' },
      { type: 'playing', name: 'ok', buttons: [{ label: 'a', url: 'http://plain.example' }] },
      { type: 'dancing', name: 'ok' },
      { type: 'playing', name: 'ok', startedAt: '2020-01-01T00:00:00.000Z' },
    ])
      expectError(
        await call(owner, 'PUT', '/users/@me/activity/media', { activity }),
        400,
        'VALIDATION_FAILED',
      );
  });
});
