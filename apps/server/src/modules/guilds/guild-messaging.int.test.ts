import { randomUUID } from 'node:crypto';
import { Permission } from '@silvercord/permissions';
import {
  guildChannelListSchema,
  guildSchema,
  messageSchema,
  uploadSchema,
} from '@silvercord/protocol';
import { and, eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { bearer, expectError, openRegistration, register } from '../../../test/auth-helpers.ts';
import { createTestApp, type TestApp } from '../../../test/test-app.ts';
import { createEventOutbox, createOutboxDispatcher } from '../../events/outbox.ts';
import { eventOutbox } from '../../events/outbox-schema.ts';
import { channelOverwrites } from '../channels/channels-schema.ts';
import { guildBans, guildMembers } from './guilds-schema.ts';

describe('guild messaging authorization and delivery', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ mediaWorker: true });
    await openRegistration(t);
  });
  afterAll(() => t.close());
  async function fixture() {
    const owner = (await register(t)).tokens;
    const member = (await register(t)).tokens;
    const outsider = (await register(t)).tokens;
    const guild = guildSchema.parse(
      (
        await t.request({
          method: 'POST',
          url: '/api/v1/users/@me/guilds',
          headers: bearer(owner),
          payload: { name: 'Messages' },
        })
      ).json(),
    );
    await t.services.db
      .insert(guildMembers)
      .values({ guildId: BigInt(guild.id), userId: BigInt(member.user.id) });
    const channel = guildChannelListSchema.parse(
      (
        await t.request({
          method: 'GET',
          url: `/api/v1/guilds/${guild.id}/channels`,
          headers: bearer(owner),
        })
      ).json(),
    ).items[0];
    if (!channel) throw new Error('missing channel');
    const root = `/api/v1/channels/${channel.id}`;
    const send = (actor = member, content = 'Hello guild') =>
      t.request({
        method: 'POST',
        url: `${root}/messages`,
        headers: { ...bearer(actor), 'idempotency-key': randomUUID() },
        payload: { content },
      });
    const deny = (bits: bigint) =>
      t.services.db.insert(channelOverwrites).values({
        channelId: BigInt(channel.id),
        targetType: 'member',
        targetId: BigInt(member.user.id),
        deny: bits,
      });
    return { owner, member, outsider, guild, channel, root, send, deny };
  }
  it('supports history, replies, edits, reactions, typing and read state while private metadata stays isolated', async () => {
    const f = await fixture();
    const sent = await f.send();
    expect(sent.statusCode, sent.body).toBe(200);
    const message = messageSchema.parse(sent.json());
    expect(
      (
        await t.request({ method: 'GET', url: `${f.root}/messages`, headers: bearer(f.owner) })
      ).json(),
    ).toMatchObject({ items: [{ id: message.id, content: 'Hello guild' }] });
    const edited = await t.request({
      method: 'PATCH',
      url: `${f.root}/messages/${message.id}`,
      headers: bearer(f.member),
      payload: { content: 'Edited', expectedVersion: 1 },
    });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(
      (
        await t.request({
          method: 'PUT',
          url: `${f.root}/messages/${message.id}/reactions/👍`,
          headers: bearer(f.owner),
          payload: {},
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (
        await t.request({
          method: 'PUT',
          url: `${f.root}/typing`,
          headers: bearer(f.member),
          payload: { active: true },
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (
        await t.request({
          method: 'PUT',
          url: `${f.root}/read-state`,
          headers: bearer(f.owner),
          payload: { messageId: message.id },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await t.request({ method: 'GET', url: f.root, headers: bearer(f.owner) })).statusCode,
    ).toBe(404);
    const rows = await t.services.db
      .select()
      .from(eventOutbox)
      .where(
        and(
          eq(eventOutbox.type, 'MESSAGE_CHANGED'),
          eq(eventOutbox.scopeChannelId, BigInt(f.channel.id)),
        ),
      );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.recipientUserId === null)).toBe(true);
    expect(Object.keys(rows[0]?.payload ?? {}).sort()).toEqual([
      'channelId',
      'eventId',
      'messageId',
    ]);
    expectError(await f.send(f.outsider), 404, 'NOT_FOUND');
  });
  it('applies send, attachment and reaction denies without denying authorized history', async () => {
    const f = await fixture();
    const message = messageSchema.parse((await f.send(f.owner)).json());
    await f.deny(Permission.SEND_MESSAGES | Permission.ADD_REACTIONS | Permission.ATTACH_FILES);
    expectError(await f.send(), 403, 'FORBIDDEN');
    expect(
      (await t.request({ method: 'GET', url: `${f.root}/messages`, headers: bearer(f.member) }))
        .statusCode,
    ).toBe(200);
    expectError(
      await t.request({
        method: 'PUT',
        url: `${f.root}/messages/${message.id}/reactions/👍`,
        headers: bearer(f.member),
        payload: {},
      }),
      403,
      'FORBIDDEN',
    );
    expectError(
      await t.request({
        method: 'POST',
        url: `${f.root}/uploads`,
        headers: bearer(f.member),
        payload: { filename: 'image.png', sizeBytes: 10 },
      }),
      403,
      'FORBIDDEN',
    );
    expectError(
      await t.request({
        method: 'PUT',
        url: `${f.root}/typing`,
        headers: bearer(f.member),
        payload: { active: true },
      }),
      403,
      'FORBIDDEN',
    );
  });
  it('removes hidden, departed and banned members from REST and queued fanout', async () => {
    const f = await fixture();
    const channelId = BigInt(f.channel.id);
    await f.send(f.owner);
    expect(await t.services.channels.viewers(t.services.db, channelId)).toContain(
      BigInt(f.member.user.id),
    );
    await f.deny(Permission.VIEW_CHANNEL);
    expectError(
      await t.request({ method: 'GET', url: `${f.root}/messages`, headers: bearer(f.member) }),
      404,
      'NOT_FOUND',
    );
    expect(await t.services.channels.viewers(t.services.db, channelId)).not.toContain(
      BigInt(f.member.user.id),
    );
    await t.services.db.delete(channelOverwrites).where(eq(channelOverwrites.channelId, channelId));
    await t.services.db.insert(guildBans).values({
      guildId: BigInt(f.guild.id),
      userId: BigInt(f.member.user.id),
      bannedBy: BigInt(f.owner.user.id),
    });
    expect(await t.services.channels.viewers(t.services.db, channelId)).not.toContain(
      BigInt(f.member.user.id),
    );
    await t.services.db.delete(guildBans).where(eq(guildBans.guildId, BigInt(f.guild.id)));
    await t.services.db
      .delete(guildMembers)
      .where(
        and(
          eq(guildMembers.guildId, BigInt(f.guild.id)),
          eq(guildMembers.userId, BigInt(f.member.user.id)),
        ),
      );
    expectError(await f.send(), 404, 'NOT_FOUND');
    const events = { dispatch: vi.fn(async () => {}), kick: vi.fn(async () => {}) };
    await createEventOutbox(t.context.nextId).enqueueChannel(
      t.services.db,
      'MESSAGE_CHANGED',
      channelId,
      { channelId: f.channel.id, messageId: '1' },
    );
    const dispatcher = createOutboxDispatcher({
      db: t.services.db,
      events,
      log: { warn: vi.fn() },
      viewers: (id) => t.services.channels.viewers(t.services.db, id),
    });
    await dispatcher.tick();
    await dispatcher.close();
    expect(
      events.dispatch.mock.calls.some(
        (args: unknown[]) => args[0] === `gw:user:${f.member.user.id}`,
      ),
    ).toBe(false);
  });
  it('denies history and media visibility after READ_MESSAGE_HISTORY is removed', async () => {
    const f = await fixture();
    await f.deny(Permission.READ_MESSAGE_HISTORY);
    expectError(
      await t.request({ method: 'GET', url: `${f.root}/messages`, headers: bearer(f.member) }),
      403,
      'FORBIDDEN',
    );
    expect(await t.services.channels.viewers(t.services.db, BigInt(f.channel.id))).not.toContain(
      BigInt(f.member.user.id),
    );
  });
  it('delivers processed guild attachments and rechecks visibility on every download', async () => {
    const f = await fixture();
    const image = await sharp({
      create: { width: 20, height: 20, channels: 3, background: '#5577ff' },
    })
      .png()
      .toBuffer();
    const reserved = await t.request({
      method: 'POST',
      url: `${f.root}/uploads`,
      headers: bearer(f.member),
      payload: { filename: 'guild.png', sizeBytes: image.length },
    });
    expect(reserved.statusCode, reserved.body).toBe(200);
    const upload = uploadSchema.parse(reserved.json());
    expect(
      (
        await t.request({
          method: 'PUT',
          url: `/api/v1/uploads/${upload.id}/chunks`,
          headers: {
            ...bearer(f.member),
            'content-type': 'application/octet-stream',
            'upload-offset': '0',
          },
          payload: image,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await t.request({
          method: 'POST',
          url: `/api/v1/uploads/${upload.id}/complete`,
          headers: bearer(f.member),
          payload: {},
        })
      ).statusCode,
    ).toBe(200);
    let ready = upload;
    for (let i = 0; i < 200; i++) {
      ready = uploadSchema.parse(
        (
          await t.request({
            method: 'GET',
            url: `/api/v1/uploads/${upload.id}`,
            headers: bearer(f.member),
          })
        ).json(),
      );
      if (ready.state === 'ready' || ready.state === 'failed') break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(ready.state).toBe('ready');
    const sent = await t.request({
      method: 'POST',
      url: `${f.root}/messages`,
      headers: { ...bearer(f.member), 'idempotency-key': randomUUID() },
      payload: { content: 'Photo', attachmentIds: [ready.id] },
    });
    expect(sent.statusCode, sent.body).toBe(200);
    const message = messageSchema.parse(sent.json());
    if (message.hidden) throw new Error('hidden');
    const path = message.attachments[0]?.variants[0]?.path;
    if (!path) throw new Error('missing processed attachment');
    expect(
      (await t.request({ method: 'GET', url: path, headers: bearer(f.owner) })).statusCode,
    ).toBe(200);
    expectError(
      await t.request({ method: 'GET', url: path, headers: bearer(f.outsider) }),
      404,
      'NOT_FOUND',
    );
    await f.deny(Permission.VIEW_CHANNEL);
    expectError(
      await t.request({ method: 'GET', url: path, headers: bearer(f.member) }),
      404,
      'NOT_FOUND',
    );
  });
});
