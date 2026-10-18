import { randomUUID } from 'node:crypto';
import {
  channelPageSchema,
  channelSchema,
  type Message,
  messagePageSchema,
  messageSchema,
  readStateSchema,
  type VisibleMessage,
} from '@silvercord/protocol';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, expectError, openRegistration, register } from '../../../test/auth-helpers.ts';
import { createTestApp, type TestApp } from '../../../test/test-app.ts';

type Account = Awaited<ReturnType<typeof register>>;
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
type Tuple<T, N extends number, R extends T[] = []> = R['length'] extends N
  ? R
  : Tuple<T, N, [T, ...R]>;

describe('private messaging', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
    await openRegistration(t);
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
    expect(
      (await call(a, 'POST', '/users/@me/relationships', { username: b.account.username }))
        .statusCode,
    ).toBe(200);
    expect((await call(b, 'PUT', `/users/@me/relationships/${id(a)}/accept`, {})).statusCode).toBe(
      200,
    );
  }
  /** Registers `count` accounts; the first is friends with every other one. */
  async function friends<N extends number>(count: N): Promise<Tuple<Account, N>> {
    const accounts: Account[] = [];
    for (let index = 0; index < count; index += 1) accounts.push(await register(t));
    const [owner, ...rest] = accounts;
    if (owner) for (const other of rest) await befriend(owner, other);
    return accounts as Tuple<Account, N>;
  }
  async function openDm(a: Account, b: Account) {
    const response = await call(a, 'POST', '/users/@me/channels', { recipientId: id(b) });
    expect(response.statusCode, response.body).toBe(200);
    return channelSchema.parse(response.json());
  }
  async function send(actor: Account, channelId: string, body: object, key: string = randomUUID()) {
    return call(actor, 'POST', `/channels/${channelId}/messages`, body, {
      'idempotency-key': key,
    });
  }
  async function sendOk(actor: Account, channelId: string, content: string, extra = {}) {
    const response = await send(actor, channelId, { content, ...extra });
    expect(response.statusCode, response.body).toBe(200);
    return visible(messageSchema.parse(response.json()));
  }
  function visible(message: Message): VisibleMessage {
    if (message.hidden) throw new Error('expected a visible message');
    return message;
  }
  const page = async (actor: Account, channelId: string, query = '') =>
    messagePageSchema.parse(
      (await call(actor, 'GET', `/channels/${channelId}/messages${query}`)).json(),
    );
  const countRows = async (table: string, where = sql`true`) =>
    (
      await t.context.database.db.execute<{ n: number }>(
        sql`select count(*)::int as n from ${sql.identifier(table)} where ${where}`,
      )
    )[0]?.n;

  describe('direct messages', () => {
    it('requires a friendship, then converges concurrent opens on one channel', async () => {
      const [a, b] = await friends(2);
      const stranger = await register(t);
      expectError(
        await call(a, 'POST', '/users/@me/channels', { recipientId: id(stranger) }),
        404,
        'NOT_FOUND',
      );
      expectError(
        await call(a, 'POST', '/users/@me/channels', { recipientId: id(a) }),
        404,
        'NOT_FOUND',
      );
      const opened = await Promise.all([openDm(a, b), openDm(b, a), openDm(a, b)]);
      expect(new Set(opened.map((channel) => channel.id)).size).toBe(1);
      expect(opened[0]?.members.map((member) => member.id).sort()).toEqual([id(a), id(b)].sort());
      expect(Object.keys(opened[0]?.members[0] ?? {}).sort()).toEqual([
        'displayName',
        'id',
        'username',
      ]);
    });

    it('hides channels and messages from non-members behind 404', async () => {
      const [a, b] = await friends(2);
      const outsider = await register(t);
      const channel = await openDm(a, b);
      const message = await sendOk(a, channel.id, 'secret');
      for (const [method, url] of [
        ['GET', `/channels/${channel.id}`],
        ['GET', `/channels/${channel.id}/messages`],
        ['GET', `/channels/${channel.id}/messages/${message.id}`],
        ['DELETE', `/channels/${channel.id}/messages/${message.id}`],
        [
          'PUT',
          `/channels/${channel.id}/messages/${message.id}/reactions/${encodeURIComponent('👍')}`,
        ],
      ] as const)
        expectError(
          await call(outsider, method, url, method === 'PUT' ? {} : undefined),
          404,
          'NOT_FOUND',
        );
      expectError(await send(outsider, channel.id, { content: 'x' }), 404, 'NOT_FOUND');
    });
  });

  describe('sending', () => {
    it('is idempotent per key, rejects key reuse with another body and never revives deletes', async () => {
      const [a, b] = await friends(2);
      const channel = await openDm(a, b);
      const key = randomUUID();
      const first = await send(a, channel.id, { content: 'hello' }, key);
      const again = await send(a, channel.id, { content: 'hello' }, key);
      expect(first.statusCode).toBe(200);
      expect(again.json()).toEqual(first.json());
      expect(await countRows('messages', sql`channel_id = ${BigInt(channel.id)}`)).toBe(1);
      expectError(await send(a, channel.id, { content: 'other' }, key), 409, 'CONFLICT');
      const messageId = visible(messageSchema.parse(first.json())).id;
      expect(
        (await call(a, 'DELETE', `/channels/${channel.id}/messages/${messageId}`)).statusCode,
      ).toBe(204);
      expectError(await send(a, channel.id, { content: 'hello' }, key), 404, 'NOT_FOUND');
    });

    it('creates exactly one message for concurrent duplicate sends', async () => {
      const [a, b] = await friends(2);
      const channel = await openDm(a, b);
      const key = randomUUID();
      const responses = await Promise.all(
        Array.from({ length: 6 }, () => send(a, channel.id, { content: 'once' }, key)),
      );
      expect(responses.map((response) => response.statusCode)).toEqual(Array(6).fill(200));
      expect(new Set(responses.map((response) => response.json<{ id: string }>().id)).size).toBe(1);
      expect(await countRows('messages', sql`channel_id = ${BigInt(channel.id)}`)).toBe(1);
      expect(
        await countRows(
          'event_outbox',
          sql`type = 'MESSAGE_CHANGED' and payload->>'channelId' = ${channel.id}`,
        ),
      ).toBe(2);
    });

    it('validates keys, empty content and attachments', async () => {
      const [a, b] = await friends(2);
      const channel = await openDm(a, b);
      const missingKey = await call(a, 'POST', `/channels/${channel.id}/messages`, {
        content: 'x',
      });
      expectError(missingKey, 400, 'VALIDATION_FAILED');
      expectError(
        await send(a, channel.id, { content: 'x' }, 'not-a-uuid'),
        400,
        'VALIDATION_FAILED',
      );
      expectError(await send(a, channel.id, { content: '   ' }), 400, 'VALIDATION_FAILED');
      expectError(
        await send(a, channel.id, { content: 'x', attachmentIds: ['1'] }),
        404,
        'NOT_FOUND',
      );
    });

    it('keeps outbox payloads free of message content', async () => {
      const [a, b] = await friends(2);
      const channel = await openDm(a, b);
      await sendOk(a, channel.id, 'unique-outbox-canary');
      const rows = await t.context.database.db.execute<{ payload: object }>(
        sql`select payload from event_outbox`,
      );
      expect(JSON.stringify(rows)).not.toContain('unique-outbox-canary');
    });

    it('records mentions only for current members', async () => {
      const [a, b] = await friends(2);
      const outsider = await register(t);
      const channel = await openDm(a, b);
      const message = await sendOk(
        a,
        channel.id,
        `<@${id(b)}> <@${id(outsider)}> <@${id(a)}> \`<@${id(b)}>\``,
      );
      expect(message.mentions).toEqual([id(b)]);
    });
  });

  describe('history', () => {
    it('pages newest first with exclusive cursors in both directions', async () => {
      const [a, b] = await friends(2);
      const channel = await openDm(a, b);
      const sent: string[] = [];
      for (let index = 0; index < 7; index += 1)
        sent.push((await sendOk(a, channel.id, `m${index}`)).id);
      const newest = await page(a, channel.id, '?limit=3');
      expect(newest.items.map((item) => item.id)).toEqual(sent.slice(4).reverse());
      expect(newest.nextBefore).toBe(sent[4]);
      const older = await page(a, channel.id, `?limit=3&before=${newest.nextBefore}`);
      expect(older.items.map((item) => item.id)).toEqual(sent.slice(1, 4).reverse());
      const after = await page(a, channel.id, `?limit=2&after=${sent[1]}`);
      expect(after.items.map((item) => item.id)).toEqual([sent[3], sent[2]]);
      expect(after.nextAfter).toBe(sent[3]);
      expect(after.nextBefore).toBeNull();
      expectError(
        await call(a, 'GET', `/channels/${channel.id}/messages?before=1&after=2`),
        400,
        'VALIDATION_FAILED',
      );
    });

    it('keeps replies in-channel and leaves a missing placeholder after deletion', async () => {
      const [a, b, c] = await friends(3);
      const ab = await openDm(a, b);
      const ac = await openDm(a, c);
      const target = await sendOk(b, ab.id, '**bold** reply target');
      const foreign = await sendOk(a, ac.id, 'elsewhere');
      expectError(await send(a, ab.id, { content: 'x', replyToId: foreign.id }), 404, 'NOT_FOUND');
      const reply = await sendOk(a, ab.id, 'answer', { replyToId: target.id });
      expect(reply.reply).toEqual({
        state: 'visible',
        id: target.id,
        author: expect.objectContaining({ id: id(b) }),
        excerpt: 'bold reply target',
      });
      expect((await call(b, 'DELETE', `/channels/${ab.id}/messages/${target.id}`)).statusCode).toBe(
        204,
      );
      const after = visible(
        messageSchema.parse(
          (await call(a, 'GET', `/channels/${ab.id}/messages/${reply.id}`)).json(),
        ),
      );
      expect(after.reply).toEqual({ state: 'missing' });
    });
  });

  describe('edits, deletes and reactions', () => {
    it('lets only the author edit, with optimistic versions', async () => {
      const [a, b] = await friends(2);
      const channel = await openDm(a, b);
      const message = await sendOk(a, channel.id, 'draft');
      const url = `/channels/${channel.id}/messages/${message.id}`;
      expectError(
        await call(b, 'PATCH', url, { content: 'hijack', expectedVersion: 1 }),
        403,
        'FORBIDDEN',
      );
      const edited = visible(
        messageSchema.parse(
          (await call(a, 'PATCH', url, { content: 'final', expectedVersion: 1 })).json(),
        ),
      );
      expect(edited).toMatchObject({ content: 'final', version: 2 });
      expect(edited.editedAt).not.toBeNull();
      expectError(
        await call(a, 'PATCH', url, { content: 'stale', expectedVersion: 1 }),
        409,
        'CONFLICT',
      );
    });

    it('lets only the author delete, and repeat deletes stay 204 for the author only', async () => {
      const [a, b] = await friends(2);
      const channel = await openDm(a, b);
      const message = await sendOk(a, channel.id, 'temporary');
      const url = `/channels/${channel.id}/messages/${message.id}`;
      expectError(await call(b, 'DELETE', url), 403, 'FORBIDDEN');
      expect((await call(a, 'DELETE', url)).statusCode).toBe(204);
      expect((await call(a, 'DELETE', url)).statusCode).toBe(204);
      expectError(await call(b, 'DELETE', url), 404, 'NOT_FOUND');
      expectError(await call(a, 'GET', url), 404, 'NOT_FOUND');
    });

    it('summarizes reactions per viewer and enforces emoji validity and limits', async () => {
      const [a, b] = await friends(2);
      const channel = await openDm(a, b);
      const message = await sendOk(a, channel.id, 'react to me');
      const reaction = (emoji: string) =>
        `/channels/${channel.id}/messages/${message.id}/reactions/${encodeURIComponent(emoji)}`;
      expect((await call(a, 'PUT', reaction('👍'), {})).statusCode).toBe(204);
      expect((await call(a, 'PUT', reaction('👍'), {})).statusCode).toBe(204);
      expect((await call(b, 'PUT', reaction('👍'), {})).statusCode).toBe(204);
      expect((await call(b, 'PUT', reaction('🇫🇷'), {})).statusCode).toBe(204);
      const forA = visible(
        messageSchema.parse(
          (await call(a, 'GET', `/channels/${channel.id}/messages/${message.id}`)).json(),
        ),
      );
      expect(forA.reactions).toEqual([
        { emoji: '👍', count: 2, me: true },
        { emoji: '🇫🇷', count: 1, me: false },
      ]);
      expect((await call(b, 'DELETE', reaction('🇫🇷'))).statusCode).toBe(204);
      expectError(await call(a, 'PUT', reaction('ab'), {}), 400, 'VALIDATION_FAILED');
      const emoji = [
        '😀',
        '😁',
        '😂',
        '🤣',
        '😃',
        '😄',
        '😅',
        '😆',
        '😉',
        '😊',
        '😋',
        '😎',
        '😍',
        '😘',
        '🥰',
        '😗',
        '😙',
        '🥲',
        '😚',
      ];
      for (const value of emoji)
        expect((await call(a, 'PUT', reaction(value), {})).statusCode).toBe(204);
      expectError(await call(b, 'PUT', reaction('🙂'), {}), 409, 'CONFLICT');
    });
  });

  describe('blocks', () => {
    it('hides blocked authors for the blocker and stops DM interaction both ways', async () => {
      const [a, b] = await friends(2);
      const channel = await openDm(a, b);
      const fromB = await sendOk(b, channel.id, 'before block');
      const fromA = await sendOk(a, channel.id, 'quote me', { replyToId: fromB.id });
      expect((await call(a, 'PUT', `/users/@me/blocks/${id(b)}`, {})).statusCode).toBe(204);
      const forA = await page(a, channel.id);
      expect(forA.items.find((item) => item.id === fromB.id)).toEqual({
        id: fromB.id,
        channelId: channel.id,
        hidden: true,
      });
      expect(visible(forA.items.find((item) => item.id === fromA.id) as Message).reply).toEqual({
        state: 'hidden',
        id: fromB.id,
      });
      const forB = await page(b, channel.id);
      expect(forB.items.every((item) => !item.hidden)).toBe(true);
      expectError(await send(a, channel.id, { content: 'x' }), 403, 'FORBIDDEN');
      expectError(await send(b, channel.id, { content: 'x' }), 403, 'FORBIDDEN');
      expectError(
        await call(a, 'POST', '/users/@me/channels', { recipientId: id(b) }),
        404,
        'NOT_FOUND',
      );
    });
  });

  describe('groups', () => {
    it('creates groups from friends only and enforces the size cap', async () => {
      const [owner, f1, f2] = await friends(3);
      const stranger = await register(t);
      expectError(
        await call(owner, 'POST', '/users/@me/channels', { recipientIds: [id(f1), id(stranger)] }),
        404,
        'NOT_FOUND',
      );
      const created = await call(owner, 'POST', '/users/@me/channels', {
        recipientIds: [id(f1), id(f2)],
        name: 'Crew',
      });
      expect(created.statusCode, created.body).toBe(200);
      expect(channelSchema.parse(created.json())).toMatchObject({
        type: 'group_dm',
        name: 'Crew',
        ownerId: id(owner),
      });
      const many = await friends(11);
      const [big, ...rest] = many;
      expectError(
        await call(big, 'POST', '/users/@me/channels', { recipientIds: rest.map(id) }),
        400,
        'VALIDATION_FAILED',
      );
    });

    it('adds friends, refuses blocked joins, transfers ownership and deletes when empty', async () => {
      const [owner, f1, f2, f3] = await friends(4);
      const group = channelSchema.parse(
        (
          await call(owner, 'POST', '/users/@me/channels', { recipientIds: [id(f1), id(f2)] })
        ).json(),
      );
      // f1 blocks f3: f3 cannot join a group f1 is in.
      expect((await call(f1, 'PUT', `/users/@me/blocks/${id(f3)}`, {})).statusCode).toBe(204);
      expectError(
        await call(owner, 'PUT', `/channels/${group.id}/members/${id(f3)}`, {}),
        404,
        'NOT_FOUND',
      );
      expectError(
        await call(f1, 'DELETE', `/channels/${group.id}/members/${id(f2)}`),
        403,
        'FORBIDDEN',
      );
      expect(
        (await call(owner, 'DELETE', `/channels/${group.id}/members/${id(owner)}`)).statusCode,
      ).toBe(204);
      const after = channelSchema.parse((await call(f1, 'GET', `/channels/${group.id}`)).json());
      const expectedOwner = [id(f1), id(f2)].sort((x, y) => (BigInt(x) < BigInt(y) ? -1 : 1))[0];
      expect(after.ownerId).toBe(expectedOwner);
      expectError(await call(owner, 'GET', `/channels/${group.id}`), 404, 'NOT_FOUND');
      await call(f1, 'DELETE', `/channels/${group.id}/members/${id(f1)}`);
      await call(f2, 'DELETE', `/channels/${group.id}/members/${id(f2)}`);
      expect(await countRows('channels', sql`id = ${BigInt(group.id)}`)).toBe(0);
    });

    it('stops a removed member from reading later messages', async () => {
      const [owner, f1, f2] = await friends(3);
      const group = channelSchema.parse(
        (
          await call(owner, 'POST', '/users/@me/channels', { recipientIds: [id(f1), id(f2)] })
        ).json(),
      );
      await sendOk(owner, group.id, 'before');
      expect(
        (await call(owner, 'DELETE', `/channels/${group.id}/members/${id(f2)}`)).statusCode,
      ).toBe(204);
      const later = await sendOk(owner, group.id, 'after removal');
      expectError(await call(f2, 'GET', `/channels/${group.id}/messages`), 404, 'NOT_FOUND');
      expectError(
        await call(f2, 'GET', `/channels/${group.id}/messages/${later.id}`),
        404,
        'NOT_FOUND',
      );
    });

    it('renames with owner-only optimistic versions', async () => {
      const [owner, f1, f2] = await friends(3);
      const group = channelSchema.parse(
        (
          await call(owner, 'POST', '/users/@me/channels', { recipientIds: [id(f1), id(f2)] })
        ).json(),
      );
      expectError(
        await call(f1, 'PATCH', `/channels/${group.id}`, {
          name: 'x',
          expectedVersion: group.version,
        }),
        403,
        'FORBIDDEN',
      );
      const renamed = channelSchema.parse(
        (
          await call(owner, 'PATCH', `/channels/${group.id}`, {
            name: 'New',
            expectedVersion: group.version,
          })
        ).json(),
      );
      expect(renamed.name).toBe('New');
      expectError(
        await call(owner, 'PATCH', `/channels/${group.id}`, {
          name: 'Old',
          expectedVersion: group.version,
        }),
        409,
        'CONFLICT',
      );
    });
  });

  describe('read states', () => {
    it('counts unread and mentions, ignores own messages and never moves backwards', async () => {
      const [a, b] = await friends(2);
      const channel = await openDm(a, b);
      const first = await sendOk(a, channel.id, 'one');
      await sendOk(a, channel.id, `two <@${id(b)}>`);
      const third = await sendOk(a, channel.id, 'three');
      const listed = channelPageSchema.parse((await call(b, 'GET', '/users/@me/channels')).json());
      expect(listed.items.find((item) => item.id === channel.id)?.readState).toEqual({
        lastReadMessageId: null,
        unreadCount: 3,
        mentionCount: 1,
      });
      const own = channelSchema.parse((await call(a, 'GET', `/channels/${channel.id}`)).json());
      expect(own.readState.unreadCount).toBe(0);
      const marked = readStateSchema.parse(
        (
          await call(b, 'PUT', `/channels/${channel.id}/read-state`, { messageId: third.id })
        ).json(),
      );
      expect(marked.lastReadMessageId).toBe(third.id);
      const regressed = readStateSchema.parse(
        (
          await call(b, 'PUT', `/channels/${channel.id}/read-state`, { messageId: first.id })
        ).json(),
      );
      expect(regressed.lastReadMessageId).toBe(third.id);
      const after = channelSchema.parse((await call(b, 'GET', `/channels/${channel.id}`)).json());
      expect(after.readState).toEqual({
        lastReadMessageId: third.id,
        unreadCount: 0,
        mentionCount: 0,
      });
      expectError(
        await call(b, 'PUT', `/channels/${channel.id}/read-state`, { messageId: '1' }),
        404,
        'NOT_FOUND',
      );
    });
  });
});
