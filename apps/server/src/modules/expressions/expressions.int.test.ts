import { randomUUID } from 'node:crypto';
import { Permission } from '@silvercord/permissions';
import {
  channelSchema,
  emoteSchema,
  expressionLookupSchema,
  guildChannelListSchema,
  guildSchema,
  messageSchema,
  type ProfileUpload,
  profileUploadSchema,
  stickerSchema,
  usableExpressionsSchema,
} from '@silvercord/protocol';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, expectError, openRegistration, register } from '../../../test/auth-helpers.ts';
import { createTestApp, type TestApp } from '../../../test/test-app.ts';
import { channelOverwrites } from '../channels/channels-schema.ts';
import { guildMembers } from '../guilds/guilds-schema.ts';

type Account = Awaited<ReturnType<typeof register>>;
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('expressions', () => {
  let t: TestApp;
  let image: Buffer;
  beforeAll(async () => {
    t = await createTestApp({ mediaWorker: true });
    await openRegistration(t);
    image = await sharp({
      create: {
        width: 96,
        height: 96,
        channels: 4,
        background: { r: 255, g: 200, b: 0, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
  });
  afterAll(() => t.close());

  const id = (account: Account) => account.tokens.user.id;
  const call = (actor: Account, method: Method, url: string, payload?: unknown, headers = {}) =>
    t.request({
      method,
      url: url.startsWith('/media/') ? url : `/api/v1${url}`,
      headers: { ...bearer(actor.tokens), ...headers },
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  async function upload(actor: Account, purpose: string, guildId: string): Promise<ProfileUpload> {
    const created = await call(actor, 'POST', '/uploads', {
      purpose,
      filename: 'e.png',
      sizeBytes: image.length,
      guildId,
    });
    expect(created.statusCode, created.body).toBe(200);
    const reserved = profileUploadSchema.parse(created.json());
    await t.request({
      method: 'PUT',
      url: `/api/v1/uploads/${reserved.id}/chunks`,
      headers: {
        ...bearer(actor.tokens),
        'content-type': 'application/octet-stream',
        'upload-offset': '0',
      },
      payload: image,
    });
    await call(actor, 'POST', `/uploads/${reserved.id}/complete`, {});
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const current = profileUploadSchema.parse(
        (await call(actor, 'GET', `/uploads/${reserved.id}`)).json(),
      );
      if (current.state === 'ready' || current.state === 'failed') return current;
      await wait(100);
    }
    throw new Error('upload never settled');
  }
  async function guildOf(owner: Account, ...members: Account[]) {
    const created = await call(owner, 'POST', '/users/@me/guilds', { name: 'Emoji Lab' });
    const guild = guildSchema.parse(created.json());
    for (const member of members)
      await t.context.database.db
        .insert(guildMembers)
        .values({ guildId: BigInt(guild.id), userId: BigInt(id(member)) });
    return guild.id;
  }
  async function dm(a: Account, b: Account) {
    await call(a, 'POST', '/users/@me/relationships', { username: b.account.username });
    await call(b, 'PUT', `/users/@me/relationships/${id(a)}/accept`, {});
    return channelSchema.parse(
      (await call(a, 'POST', '/users/@me/channels', { recipientId: id(b) })).json(),
    ).id;
  }
  const send = async (actor: Account, channelId: string, content: string) => {
    const response = await call(
      actor,
      'POST',
      `/channels/${channelId}/messages`,
      { content },
      { 'idempotency-key': randomUUID() },
    );
    expect(response.statusCode, response.body).toBe(200);
    const message = messageSchema.parse(response.json());
    if (message.hidden) throw new Error('hidden');
    return message;
  };

  it('lets managers add emotes and stickers, and members use them in DMs', async () => {
    const owner = await register(t);
    const member = await register(t);
    const outsider = await register(t);
    const guildId = await guildOf(owner, member);

    // Members without MANAGE_EMOJIS cannot even upload for the guild.
    expectError(
      await call(member, 'POST', '/uploads', {
        purpose: 'emote',
        filename: 'e.png',
        sizeBytes: image.length,
        guildId,
      }),
      403,
      'FORBIDDEN',
    );
    const emoteUpload = await upload(owner, 'emote', guildId);
    expect(emoteUpload.state).toBe('ready');
    const created = await call(owner, 'POST', `/guilds/${guildId}/emotes`, {
      name: 'sparkle_cat',
      uploadId: emoteUpload.id,
    });
    expect(created.statusCode, created.body).toBe(201);
    const emote = emoteSchema.parse(created.json());
    expectError(
      await call(owner, 'POST', `/guilds/${guildId}/emotes`, {
        name: 'SPARKLE_CAT',
        uploadId: (await upload(owner, 'emote', guildId)).id,
      }),
      409,
      'CONFLICT',
    );
    const stickerUpload = await upload(owner, 'sticker', guildId);
    const sticker = stickerSchema.parse(
      (
        await call(owner, 'POST', `/guilds/${guildId}/stickers`, {
          name: 'Thumbs',
          description: 'Nice',
          relatedEmoji: '👍',
          uploadId: stickerUpload.id,
        })
      ).json(),
    );

    const usable = usableExpressionsSchema.parse(
      (await call(member, 'GET', '/users/@me/expressions')).json(),
    );
    expect(usable.guilds[0]?.emotes.map((item) => item.id)).toEqual([emote.id]);

    const channelId = await dm(member, outsider);
    const fromMember = await send(
      member,
      channelId,
      `hi <:xx:${emote.id}> <sticker:${sticker.id}>`,
    );
    expect(fromMember.content).toBe(`hi <:sparkle_cat:${emote.id}> <sticker:${sticker.id}>`);
    const fromOutsider = await send(
      outsider,
      channelId,
      `copy <:sparkle_cat:${emote.id}> <sticker:${sticker.id}>`,
    );
    expect(fromOutsider.content).toBe('copy :sparkle_cat: ');

    // Viewing needs no membership.
    const lookup = expressionLookupSchema.parse(
      (
        await call(
          outsider,
          'GET',
          `/expressions/lookup?emoteIds=${emote.id}&stickerIds=${sticker.id}`,
        )
      ).json(),
    );
    expect(lookup.emotes).toHaveLength(1);
    expect((await call(outsider, 'GET', emote.image.display)).statusCode).toBe(200);

    // Custom reactions follow the same rule.
    const reaction = encodeURIComponent(`custom:${emote.id}`);
    const path = `/channels/${channelId}/messages/${fromMember.id}/reactions/${reaction}`;
    expect((await call(member, 'PUT', path, {})).statusCode).toBe(204);
    expectError(await call(outsider, 'PUT', path, {}), 403, 'FORBIDDEN');

    // Deleting the emote stops delivery.
    expect((await call(owner, 'DELETE', `/guilds/${guildId}/emotes/${emote.id}`)).statusCode).toBe(
      204,
    );
    expect((await call(outsider, 'GET', emote.image.display)).statusCode).toBe(404);
    const after = expressionLookupSchema.parse(
      (await call(outsider, 'GET', `/expressions/lookup?emoteIds=${emote.id}`)).json(),
    );
    expect(after.emotes).toEqual([]);
    expectError(await call(outsider, 'GET', `/guilds/${guildId}/expressions`), 404, 'NOT_FOUND');
  });
  it('checks USE_EXTERNAL_EMOJIS for guild sends and custom reactions', async () => {
    const owner = await register(t);
    const member = await register(t);
    const local = await guildOf(owner, member);
    const external = await guildOf(owner, member);
    const localChannel = guildChannelListSchema.parse(
      (await call(member, 'GET', `/guilds/${local}/channels`)).json(),
    ).items[0];
    if (!localChannel) throw new Error('missing local channel');
    const uploaded = await upload(owner, 'emote', external);
    const emote = emoteSchema.parse(
      (
        await call(owner, 'POST', `/guilds/${external}/emotes`, {
          name: 'wave',
          uploadId: uploaded.id,
        })
      ).json(),
    );
    expect((await send(member, localChannel.id, `<:wave:${emote.id}>`)).content).toBe(
      `<:wave:${emote.id}>`,
    );
    await t.services.db.insert(channelOverwrites).values({
      channelId: BigInt(localChannel.id),
      targetType: 'member',
      targetId: BigInt(id(member)),
      deny: Permission.USE_EXTERNAL_EMOJIS,
    });
    const rewritten = await send(member, localChannel.id, `<:wave:${emote.id}>`);
    expect(rewritten.content).toBe(':wave:');
    expectError(
      await call(
        member,
        'PUT',
        `/channels/${localChannel.id}/messages/${rewritten.id}/reactions/custom:${emote.id}`,
        {},
      ),
      403,
      'FORBIDDEN',
    );
    await t.services.db
      .delete(channelOverwrites)
      .where(eq(channelOverwrites.channelId, BigInt(localChannel.id)));
    expect(
      (
        await call(
          member,
          'PUT',
          `/channels/${localChannel.id}/messages/${rewritten.id}/reactions/custom:${emote.id}`,
          {},
        )
      ).statusCode,
    ).toBe(204);
  });
});
