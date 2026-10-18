import {
  relationshipPageSchema,
  relationshipViewSchema,
  socialPrivacySchema,
} from '@silvercord/protocol';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, expectError, openRegistration, register } from '../../../test/auth-helpers.ts';
import { createTestApp, type TestApp } from '../../../test/test-app.ts';
import { createEventOutbox } from '../../events/outbox.ts';
import { createUsersService } from '../users/users-service.ts';
import { createRelationshipsService } from './relationships-service.ts';

const ROOT = '/api/v1/users/@me';
describe('private relationships', () => {
  let t: TestApp;
  const logLines: string[] = [];
  beforeAll(async () => {
    t = await createTestApp({ logLines });
    await openRegistration(t);
  });
  afterAll(() => t.close());
  const pair = async () => ({ a: await register(t), b: await register(t) });
  type Account = Awaited<ReturnType<typeof register>>;
  const call = (
    actor: Account,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    payload?: unknown,
  ) =>
    t.request({
      method,
      url: `${ROOT}${path}`,
      headers: bearer(actor.tokens),
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  const request = (actor: Account, target: Account) =>
    call(actor, 'POST', '/relationships', { username: target.account.username });
  const list = async (actor: Account, kind: string) =>
    relationshipPageSchema.parse((await call(actor, 'GET', `/relationships?kind=${kind}`)).json());

  it('creates default privacy for every account, with owner-only patches', async () => {
    const { a, b } = await pair();
    expect(socialPrivacySchema.parse((await call(a, 'GET', '/privacy')).json())).toEqual({
      friendRequests: 'everyone',
      directMessages: 'friends',
      version: 1,
    });
    expect((await call(a, 'PATCH', '/privacy', { directMessages: 'nobody' })).statusCode).toBe(200);
    expect(
      socialPrivacySchema.parse((await call(b, 'GET', '/privacy')).json()).directMessages,
    ).toBe('friends');
    expectError(
      await call(a, 'PATCH', '/privacy', { userId: b.tokens.user.id, directMessages: 'friends' }),
      400,
      'VALIDATION_FAILED',
    );
  });

  it('keeps crossed requests pending, duplicate requests idempotent, and accept recipient-only', async () => {
    const { a, b } = await pair();
    const outgoing = relationshipViewSchema.parse((await request(a, b)).json());
    expect(outgoing.kind).toBe('outgoing');
    expect(relationshipViewSchema.parse((await request(a, b)).json())).toEqual(outgoing);
    const incoming = relationshipViewSchema.parse((await request(b, a)).json());
    expect(incoming).toMatchObject({
      id: outgoing.id,
      kind: 'incoming',
      version: outgoing.version,
    });
    expectError(
      await call(a, 'PUT', `/relationships/${b.tokens.user.id}/accept`, {}),
      404,
      'NOT_FOUND',
    );
    const accepted = relationshipViewSchema.parse(
      (await call(b, 'PUT', `/relationships/${a.tokens.user.id}/accept`, {})).json(),
    );
    expect(accepted).toMatchObject({
      id: outgoing.id,
      kind: 'friends',
      version: outgoing.version + 1,
    });
    expect((await list(a, 'friends')).items).toHaveLength(1);
    expect((await list(a, 'outgoing')).items).toHaveLength(0);
    expect(Object.keys(accepted.user).sort()).toEqual(['displayName', 'id', 'username']);
  });

  it('keeps existing requests and friendships idempotent after request privacy is disabled', async () => {
    const { a, b } = await pair();
    const outgoing = relationshipViewSchema.parse((await request(a, b)).json());
    await call(b, 'PATCH', '/privacy', { friendRequests: 'nobody' });
    const retry = await request(a, b);
    expect(retry.statusCode, retry.body).toBe(200);
    expect(relationshipViewSchema.parse(retry.json())).toEqual(outgoing);
    await call(b, 'PUT', `/relationships/${a.tokens.user.id}/accept`, {});
    const friends = relationshipViewSchema.parse((await request(a, b)).json());
    expect(friends.kind).toBe('friends');
    expect(relationshipViewSchema.parse((await request(a, b)).json())).toEqual(friends);
    const stranger = await register(t);
    expectError(await request(stranger, b), 404, 'NOT_FOUND');
  });

  it('makes self, absent, blocked and disabled targets indistinguishable', async () => {
    const { a, b } = await pair();
    const responses = [
      await request(a, a),
      await call(a, 'POST', '/relationships', { username: 'no_such_account' }),
    ];
    await call(b, 'PATCH', '/privacy', { friendRequests: 'nobody' });
    responses.push(await request(a, b));
    await call(b, 'PATCH', '/privacy', { friendRequests: 'everyone' });
    await call(b, 'PUT', `/blocks/${a.tokens.user.id}`, {});
    responses.push(await request(a, b));
    for (const response of responses) expectError(response, 404, 'NOT_FOUND');
    expect(
      new Set(responses.map((r) => r.json<{ error: { message: string } }>().error.message)).size,
    ).toBe(1);
    expect((await list(a, 'blocked')).items).toHaveLength(0);
    expect((await list(b, 'blocked')).items).toHaveLength(1);
  });

  it('keeps notes/nicknames private, rejects unrelated annotations and accepts explicit clearing', async () => {
    const { a, b } = await pair();
    const stranger = await register(t);
    expectError(
      await call(stranger, 'PUT', `/relationships/${a.tokens.user.id}/metadata`, {
        nickname: 'secret',
        note: 'private',
      }),
      404,
      'NOT_FOUND',
    );
    await request(a, b);
    expect(
      (
        await call(a, 'PUT', `/relationships/${b.tokens.user.id}/metadata`, {
          nickname: 'My friend',
          note: 'private note',
        })
      ).statusCode,
    ).toBe(200);
    expect((await list(a, 'outgoing')).items[0]?.metadata).toEqual({
      nickname: 'My friend',
      note: 'private note',
    });
    expect((await list(b, 'incoming')).items[0]?.metadata).toEqual({ nickname: null, note: null });
    expect(
      (
        await call(a, 'PUT', `/relationships/${b.tokens.user.id}/metadata`, {
          nickname: null,
          note: null,
        })
      ).json(),
    ).toEqual({ nickname: null, note: null });
    const outbox = await t.context.database.db.execute<{ payload: unknown }>(
      sql`select payload from event_outbox`,
    );
    expect(JSON.stringify(outbox)).not.toMatch(/private note|My friend|example\.test|nickname/);
    expect(logLines.join('')).not.toMatch(/private note|My friend/);
  });

  it('atomically removes pending/friend state on block, and unblocking does not restore it', async () => {
    const { a, b } = await pair();
    await request(a, b);
    await call(b, 'PUT', `/relationships/${a.tokens.user.id}/accept`, {});
    for (let i = 0; i < 2; i++)
      expect((await call(a, 'PUT', `/blocks/${b.tokens.user.id}`, {})).statusCode).toBe(204);
    expect((await list(a, 'friends')).items).toHaveLength(0);
    expect((await list(b, 'friends')).items).toHaveLength(0);
    expectError(await request(b, a), 404, 'NOT_FOUND');
    for (let i = 0; i < 2; i++)
      expect((await call(a, 'DELETE', `/blocks/${b.tokens.user.id}`)).statusCode).toBe(204);
    expect((await list(a, 'blocked')).items).toHaveLength(0);
    expect((await list(a, 'friends')).items).toHaveLength(0);
  });

  it('serializes crossing requests and block versus accept without stale friendship', async () => {
    const { a, b } = await pair();
    await Promise.all([request(a, b), request(b, a)]);
    const incomingA = await list(a, 'incoming');
    const recipient = incomingA.items.length ? a : b;
    const sender = recipient === a ? b : a;
    const [accepted, blocked] = await Promise.all([
      call(recipient, 'PUT', `/relationships/${sender.tokens.user.id}/accept`, {}),
      call(sender, 'PUT', `/blocks/${recipient.tokens.user.id}`, {}),
    ]);
    expect([200, 404]).toContain(accepted.statusCode);
    expect(blocked.statusCode).toBe(204);
    expect((await list(a, 'friends')).items).toHaveLength(0);
    expect((await list(b, 'friends')).items).toHaveLength(0);
    const rows = await t.context.database.db.execute<{ state: string }>(
      sql`select state from relationship_pairs where user_low = least(${BigInt(a.tokens.user.id)}, ${BigInt(b.tokens.user.id)}) and user_high = greatest(${BigInt(a.tokens.user.id)}, ${BigInt(b.tokens.user.id)})`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.state).toBe('none');
  });

  it('lets either party cancel/decline/remove idempotently without a third-party effect', async () => {
    const { a, b } = await pair();
    const c = await register(t);
    await request(a, b);
    expect((await call(c, 'DELETE', `/relationships/${a.tokens.user.id}`)).statusCode).toBe(204);
    expect((await list(a, 'outgoing')).items).toHaveLength(1);
    for (let i = 0; i < 2; i++)
      expect((await call(b, 'DELETE', `/relationships/${a.tokens.user.id}`)).statusCode).toBe(204);
    expect((await list(a, 'outgoing')).items).toHaveLength(0);
  });

  it('requires auth and validates strict bodies, ids and mutually exclusive pagination', async () => {
    const { a } = await pair();
    expectError(
      await t.request({ method: 'GET', url: `${ROOT}/relationships?kind=friends` }),
      401,
      'UNAUTHENTICATED',
    );
    for (const [method, path, payload] of [
      ['POST', '/relationships', { username: a.account.username, ownerId: '1' }],
      ['PUT', '/blocks/not-an-id', {}],
      ['PUT', '/relationships/not-an-id/accept', {}],
      ['GET', '/relationships?kind=friends&before=3&after=1', undefined],
      ['PUT', `/relationships/${a.tokens.user.id}/metadata`, { nickname: '', note: null }],
      ['PATCH', '/privacy', {}],
    ] as const)
      expectError(await call(a, method, path, payload), 400, 'VALIDATION_FAILED');
  });

  it('paginates exclusive snowflake bounds and returns the nearest newer rows in descending order', async () => {
    const owner = await register(t);
    const targets = await Promise.all([register(t), register(t), register(t)]);
    const ids: bigint[] = [];
    for (const target of targets)
      ids.push(BigInt(relationshipViewSchema.parse((await request(owner, target)).json()).id));
    const newest = ids[2];
    const middle = ids[1];
    const oldest = ids[0];
    const page = relationshipPageSchema.parse(
      (await call(owner, 'GET', '/relationships?kind=outgoing&limit=1')).json(),
    );
    expect(page.items.map((item) => item.id)).toEqual([String(newest)]);
    expect(page.nextBefore).toBe(String(newest));
    const older = relationshipPageSchema.parse(
      (await call(owner, 'GET', `/relationships?kind=outgoing&before=${newest}&limit=1`)).json(),
    );
    expect(older.items.map((item) => item.id)).toEqual([String(middle)]);
    const newer = relationshipPageSchema.parse(
      (await call(owner, 'GET', `/relationships?kind=outgoing&after=${oldest}&limit=1`)).json(),
    );
    expect(newer.items.map((item) => item.id)).toEqual([String(middle)]);
  });

  it('rechecks DM and presence policy under the same locks as privacy changes and blocks', async () => {
    const { a, b } = await pair();
    const aId = BigInt(a.tokens.user.id);
    const bId = BigInt(b.tokens.user.id);
    const service = createRelationshipsService({
      users: createUsersService(),
      nextId: t.context.nextId,
      outbox: createEventOutbox(t.context.nextId),
    });
    const db = t.context.database.db;
    expect(await service.canDirectMessage(db, aId, bId)).toBe(false);
    await request(a, b);
    await call(b, 'PUT', `/relationships/${aId}/accept`, {});
    expect(await service.canDirectMessage(db, aId, bId)).toBe(true);
    expect(await service.canSeePresence(db, aId, bId)).toBe(true);
    await call(b, 'PATCH', '/privacy', { directMessages: 'nobody' });
    expect(await service.canDirectMessage(db, aId, bId)).toBe(false);
    expect(await service.canDirectMessage(db, bId, aId)).toBe(true);
    await call(a, 'PUT', `/blocks/${bId}`, {});
    expect(await service.canDirectMessage(db, bId, aId)).toBe(false);
    expect(await service.canSeePresence(db, aId, bId)).toBe(false);
  });

  it('preserves simultaneous privacy changes without losing either field', async () => {
    const owner = await register(t);
    const responses = await Promise.all([
      call(owner, 'PATCH', '/privacy', { friendRequests: 'nobody' }),
      call(owner, 'PATCH', '/privacy', { directMessages: 'nobody' }),
    ]);
    expect(responses.map((response) => response.statusCode)).toEqual([200, 200]);
    expect((await call(owner, 'GET', '/privacy')).json()).toEqual({
      friendRequests: 'nobody',
      directMessages: 'nobody',
      version: 3,
    });
  });

  it('orders accept versus cancellation so a canceled request cannot become a friendship', async () => {
    const { a, b } = await pair();
    await request(a, b);
    const [accept, cancel] = await Promise.all([
      call(b, 'PUT', `/relationships/${a.tokens.user.id}/accept`, {}),
      call(a, 'DELETE', `/relationships/${b.tokens.user.id}`),
    ]);
    expect([200, 404]).toContain(accept.statusCode);
    expect(cancel.statusCode).toBe(204);
    expect((await list(a, 'friends')).items).toHaveLength(0);
    expect((await list(b, 'incoming')).items).toHaveLength(0);
  });

  it('keeps private annotations out of failed-query logs and error responses', async () => {
    const { a, b } = await pair();
    await request(a, b);
    const secret = 'do-not-log-sensitive-annotation';
    await t.context.database.db.execute(
      sql`create function reject_private_annotation() returns trigger language plpgsql as $$ begin raise exception 'annotation rejected: %', NEW.note; end; $$`,
    );
    await t.context.database.db.execute(
      sql`create trigger reject_private_annotation before insert on relationship_metadata for each row execute function reject_private_annotation()`,
    );
    try {
      const response = await call(a, 'PUT', `/relationships/${b.tokens.user.id}/metadata`, {
        nickname: null,
        note: secret,
      });
      expectError(response, 500, 'INTERNAL');
      expect(response.body).not.toContain(secret);
      expect(logLines.join('')).not.toContain(secret);
    } finally {
      await t.context.database.db.execute(
        sql`drop trigger reject_private_annotation on relationship_metadata`,
      );
      await t.context.database.db.execute(sql`drop function reject_private_annotation()`);
    }
  });
});

describe('relationship route guards and budgets', () => {
  let t: TestApp;
  let deny = false;
  let accessToken = '';
  beforeAll(async () => {
    t = await createTestApp({
      rateLimiter: {
        consume: async (key) => ({
          allowed: !deny || key.startsWith('global:'),
          remaining: 0,
          retryAfterMs: 1000,
        }),
      },
    });
    await openRegistration(t);
    accessToken = (await register(t)).tokens.accessToken;
  });
  afterAll(() => t.close());
  const routes = [
    ['GET', '/relationships?kind=friends'],
    ['POST', '/relationships'],
    ['PUT', '/relationships/1/accept'],
    ['DELETE', '/relationships/1'],
    ['PUT', '/blocks/1'],
    ['DELETE', '/blocks/1'],
    ['PUT', '/relationships/1/metadata'],
    ['GET', '/privacy'],
    ['PATCH', '/privacy'],
  ] as const;
  it('requires authentication on all social routes', async () => {
    for (const [method, path] of routes)
      expectError(
        await t.request({
          method,
          url: `${ROOT}${path}`,
          ...(method === 'GET' || method === 'DELETE' ? {} : { payload: {} }),
        }),
        401,
        'UNAUTHENTICATED',
      );
  });
  it('enforces each declared per-user budget before processing input', async () => {
    deny = true;
    try {
      for (const [method, path] of routes)
        expectError(
          await t.request({
            method,
            url: `${ROOT}${path}`,
            headers: bearer({ accessToken }),
            ...(method === 'GET' || method === 'DELETE' ? {} : { payload: {} }),
          }),
          429,
          'RATE_LIMITED',
        );
    } finally {
      deny = false;
    }
  });
});
