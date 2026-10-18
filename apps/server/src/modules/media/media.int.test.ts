import { randomUUID } from 'node:crypto';
import {
  channelSchema,
  type Message,
  messageSchema,
  type Upload,
  uploadSchema,
  type VisibleMessage,
} from '@silvercord/protocol';
import { sql } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, expectError, openRegistration, register } from '../../../test/auth-helpers.ts';
import { createTestApp, type TestApp } from '../../../test/test-app.ts';

type Account = Awaited<ReturnType<typeof register>>;
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('private media', () => {
  let t: TestApp;
  let photo: Buffer;
  beforeAll(async () => {
    t = await createTestApp({ mediaWorker: true });
    await openRegistration(t);
    photo = await sharp({
      create: { width: 900, height: 600, channels: 3, background: { r: 40, g: 120, b: 200 } },
    })
      .jpeg()
      .withExif({ IFD0: { Copyright: 'gps-owner-canary' } })
      .toBuffer();
  });
  afterAll(() => t.close());

  const id = (account: Account) => account.tokens.user.id;
  const call = (actor: Account, method: Method, url: string, payload?: unknown, headers = {}) =>
    t.request({
      method,
      url,
      headers: { ...bearer(actor.tokens), ...headers },
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  async function dm() {
    const a = await register(t);
    const b = await register(t);
    await call(a, 'POST', '/api/v1/users/@me/relationships', { username: b.account.username });
    await call(b, 'PUT', `/api/v1/users/@me/relationships/${id(a)}/accept`, {});
    const channel = channelSchema.parse(
      (await call(a, 'POST', '/api/v1/users/@me/channels', { recipientId: id(b) })).json(),
    );
    return { a, b, channelId: channel.id };
  }
  const create = (actor: Account, channelId: string, filename: string, sizeBytes: number) =>
    call(actor, 'POST', `/api/v1/channels/${channelId}/uploads`, { filename, sizeBytes });
  const chunk = (actor: Account, uploadId: string, offset: number, body: Buffer) =>
    t.request({
      method: 'PUT',
      url: `/api/v1/uploads/${uploadId}/chunks`,
      headers: {
        ...bearer(actor.tokens),
        'content-type': 'application/octet-stream',
        'upload-offset': String(offset),
      },
      payload: body,
    });
  async function waitFor(actor: Account, uploadId: string, states: Upload['state'][]) {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const upload = uploadSchema.parse(
        (await call(actor, 'GET', `/api/v1/uploads/${uploadId}`)).json(),
      );
      if (states.includes(upload.state)) return upload;
      await wait(100);
    }
    throw new Error('upload never settled');
  }
  async function uploadFile(actor: Account, channelId: string, filename: string, bytes: Buffer) {
    const created = await create(actor, channelId, filename, bytes.length);
    expect(created.statusCode, created.body).toBe(200);
    const upload = uploadSchema.parse(created.json());
    const half = Math.ceil(bytes.length / 2);
    expect((await chunk(actor, upload.id, 0, bytes.subarray(0, half))).json()).toEqual({
      offset: half,
    });
    expect((await chunk(actor, upload.id, half, bytes.subarray(half))).json()).toEqual({
      offset: bytes.length,
    });
    const completed = await call(actor, 'POST', `/api/v1/uploads/${upload.id}/complete`, {});
    expect(completed.statusCode, completed.body).toBe(200);
    return waitFor(actor, upload.id, ['ready', 'failed']);
  }
  async function sendWith(
    actor: Account,
    channelId: string,
    attachmentIds: string[],
    key = randomUUID(),
  ) {
    return call(
      actor,
      'POST',
      `/api/v1/channels/${channelId}/messages`,
      { content: '', attachmentIds },
      { 'idempotency-key': key },
    );
  }
  const visible = (message: Message): VisibleMessage => {
    if (message.hidden) throw new Error('hidden');
    return message;
  };

  it('processes an image, strips metadata and delivers it only to current members', async () => {
    const { a, b, channelId } = await dm();
    const ready = await uploadFile(a, channelId, 'holiday.jpg', photo);
    expect(ready).toMatchObject({ state: 'ready', failure: null });
    const sent = await sendWith(a, channelId, [ready.id]);
    expect(sent.statusCode, sent.body).toBe(200);
    const message = visible(messageSchema.parse(sent.json()));
    const [attachment] = message.attachments;
    expect(attachment).toMatchObject({
      id: ready.id,
      filename: 'holiday.jpg',
      kind: 'image',
      contentType: 'image/jpeg',
      width: 900,
      height: 600,
      animated: false,
    });
    expect(attachment?.variants.map((variant) => variant.variant).sort()).toEqual([
      'display',
      'download',
      'thumbnail',
    ]);
    const download = attachment?.variants.find((variant) => variant.variant === 'download');
    const fetched = await call(b, 'GET', download?.path ?? '');
    expect(fetched.statusCode).toBe(200);
    expect(fetched.headers).toMatchObject({
      'content-type': 'image/jpeg',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      'cache-control': 'private, no-store',
    });
    expect(String(fetched.headers['content-disposition'])).toContain('attachment;');
    expect(fetched.rawPayload.includes('gps-owner-canary')).toBe(false);
    expect((await sharp(fetched.rawPayload).metadata()).exif).toBeUndefined();

    const outsider = await register(t);
    expectError(await call(outsider, 'GET', download?.path ?? ''), 404, 'NOT_FOUND');
    expectError(await call(outsider, 'GET', `/api/v1/attachments/${ready.id}`), 404, 'NOT_FOUND');
    const wrongHash = download?.path.replace(/[a-f0-9]{64}$/, '0'.repeat(64)) ?? '';
    expectError(await call(b, 'GET', wrongHash), 404, 'NOT_FOUND');
    await call(b, 'PUT', `/api/v1/users/@me/blocks/${id(a)}`, {});
    expectError(await call(b, 'GET', download?.path ?? ''), 404, 'NOT_FOUND');
  });

  it('resumes chunks idempotently and rejects conflicting or misplaced bytes', async () => {
    const { a, channelId } = await dm();
    const upload = uploadSchema.parse((await create(a, channelId, 'x.jpg', photo.length)).json());
    const first = photo.subarray(0, 100);
    expect((await chunk(a, upload.id, 0, first)).json()).toEqual({ offset: 100 });
    expect((await chunk(a, upload.id, 0, first)).json()).toEqual({ offset: 100 });
    expectError(await chunk(a, upload.id, 0, Buffer.alloc(100, 1)), 409, 'CONFLICT');
    expectError(await chunk(a, upload.id, 500, photo.subarray(500, 600)), 409, 'CONFLICT');
    expectError(
      await chunk(a, upload.id, 100, Buffer.alloc(photo.length)),
      413,
      'PAYLOAD_TOO_LARGE',
    );
    expectError(
      await call(a, 'POST', `/api/v1/uploads/${upload.id}/complete`, {}),
      409,
      'CONFLICT',
    );
    const other = await register(t);
    expectError(await chunk(other, upload.id, 100, photo.subarray(100, 200)), 404, 'NOT_FOUND');
    expect((await call(a, 'DELETE', `/api/v1/uploads/${upload.id}`)).statusCode).toBe(204);
    expectError(await call(a, 'GET', `/api/v1/uploads/${upload.id}`), 404, 'NOT_FOUND');
  });

  it('fails spoofed markup and keeps unknown files download-only', async () => {
    const { a, channelId } = await dm();
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    const failed = await uploadFile(a, channelId, 'photo.jpg', svg);
    expect(failed).toMatchObject({
      state: 'failed',
      failure: 'UNSUPPORTED_TYPE',
      attachment: null,
    });
    expectError(await sendWith(a, channelId, [failed.id]), 409, 'CONFLICT');

    const pdf = await uploadFile(a, channelId, 'notes.pdf', Buffer.from('%PDF-1.7 not really'));
    expect(pdf.state).toBe('ready');
    expect(pdf.attachment).toMatchObject({ kind: 'file', contentType: 'application/octet-stream' });
    expect(pdf.attachment?.variants.map((variant) => variant.variant)).toEqual(['download']);
  });

  it('refuses foreign, cross-channel and double-used uploads', async () => {
    const first = await dm();
    const second = await dm();
    const ready = await uploadFile(first.a, first.channelId, 'a.jpg', photo);
    expectError(await sendWith(second.a, second.channelId, [ready.id]), 404, 'NOT_FOUND');
    const key = randomUUID();
    const sent = await sendWith(first.a, first.channelId, [ready.id], key);
    expect(sent.statusCode).toBe(200);
    expect((await sendWith(first.a, first.channelId, [ready.id], key)).json()).toEqual(sent.json());
    expectError(await sendWith(first.a, first.channelId, [ready.id]), 409, 'CONFLICT');
  });

  it('enforces size, concurrency and send access at reservation', async () => {
    const { a, b, channelId } = await dm();
    expectError(await create(a, channelId, 'big.bin', 26 * 1024 * 1024), 413, 'PAYLOAD_TOO_LARGE');
    for (let index = 0; index < 3; index += 1)
      expect((await create(a, channelId, `f${index}.bin`, 10)).statusCode).toBe(200);
    expectError(await create(a, channelId, 'f4.bin', 10), 409, 'CONFLICT');
    const outsider = await register(t);
    expectError(await create(outsider, channelId, 'x.bin', 10), 404, 'NOT_FOUND');
    await call(a, 'PUT', `/api/v1/users/@me/blocks/${id(b)}`, {});
    expectError(await create(b, channelId, 'x.bin', 10), 403, 'FORBIDDEN');
  });

  it('cleans up objects and quota after the message is deleted', async () => {
    const { a, channelId } = await dm();
    const ready = await uploadFile(a, channelId, 'gone.jpg', photo);
    const message = visible(messageSchema.parse((await sendWith(a, channelId, [ready.id])).json()));
    const quota = async () =>
      (
        await t.context.database.db.execute<{ stored: number }>(
          sql`select stored_bytes::int as stored from media_quota_usage where scope = ${`user:${id(a)}`}`,
        )
      )[0]?.stored;
    expect(await quota()).toBeGreaterThan(0);
    expect(
      (await call(a, 'DELETE', `/api/v1/channels/${channelId}/messages/${message.id}`)).statusCode,
    ).toBe(204);
    await t.services.media.sweep();
    expect(await quota()).toBe(0);
    const keys = await t.context.database.db.execute(
      sql`select 1 from media_variants where upload_id = ${BigInt(ready.id)}`,
    );
    expect(keys).toHaveLength(0);
  });

  it('releases quota and objects when a whole group is deleted', async () => {
    const owner = await register(t);
    const friend = await register(t);
    await call(owner, 'POST', '/api/v1/users/@me/relationships', {
      username: friend.account.username,
    });
    await call(friend, 'PUT', `/api/v1/users/@me/relationships/${id(owner)}/accept`, {});
    const third = await register(t);
    await call(owner, 'POST', '/api/v1/users/@me/relationships', {
      username: third.account.username,
    });
    await call(third, 'PUT', `/api/v1/users/@me/relationships/${id(owner)}/accept`, {});
    const group = channelSchema.parse(
      (
        await call(owner, 'POST', '/api/v1/users/@me/channels', {
          recipientIds: [id(friend), id(third)],
        })
      ).json(),
    );
    const ready = await uploadFile(owner, group.id, 'group.jpg', photo);
    expect((await sendWith(owner, group.id, [ready.id])).statusCode).toBe(200);
    for (const member of [owner, friend, third])
      await call(member, 'DELETE', `/api/v1/channels/${group.id}/members/${id(member)}`);
    const rows = await t.context.database.db.execute<{ stored: number; reserved: number }>(
      sql`select stored_bytes::int as stored, reserved_bytes::int as reserved from media_quota_usage where scope = ${`user:${id(owner)}`}`,
    );
    expect(rows[0]).toEqual({ stored: 0, reserved: 0 });
  });
});
