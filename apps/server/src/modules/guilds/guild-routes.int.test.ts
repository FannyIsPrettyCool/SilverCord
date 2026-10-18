import { DEFAULT_EVERYONE_PERMISSIONS, Permission } from '@silvercord/permissions';
import { guildChannelListSchema, guildChannelSchema, guildSchema } from '@silvercord/protocol';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, expectError, openRegistration, register } from '../../../test/auth-helpers.ts';
import { createTestApp, type TestApp } from '../../../test/test-app.ts';
import { channelOverwrites } from '../channels/channels-schema.ts';
import { guildMembers, roles } from './guilds-schema.ts';

describe('guild channel HTTP permission matrix', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
    await openRegistration(t);
  });
  afterAll(() => t.close());

  async function fixture() {
    const owner = (await register(t)).tokens;
    const member = (await register(t)).tokens;
    const created = await t.request({
      method: 'POST',
      url: '/api/v1/users/@me/guilds',
      headers: bearer(owner),
      payload: { name: 'Matrix' },
    });
    expect(created.statusCode).toBe(201);
    const guild = guildSchema.parse(created.json());
    await t.context.database.db
      .insert(guildMembers)
      .values({ guildId: BigInt(guild.id), userId: BigInt(member.user.id) });
    const path = `/api/v1/guilds/${guild.id}/channels`;
    const list = await t.request({ method: 'GET', url: path, headers: bearer(owner) });
    const general = guildChannelListSchema.parse(list.json()).items[0];
    expect(general).toBeDefined();
    if (!general) throw new Error('missing general');
    return { owner, member, guild, path, general };
  }

  it('allows ordinary members to list but checks current management permission for create and edit', async () => {
    const f = await fixture();
    const request = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
      t.request({ method, url, headers: bearer(f.member), ...(payload ? { payload } : {}) });
    expect((await request('GET', f.path)).statusCode).toBe(200);
    expectError(
      await request('POST', f.path, { type: 'guild_text', name: 'denied' }),
      403,
      'FORBIDDEN',
    );
    expectError(
      await request('PATCH', `${f.path}/${f.general.id}`, { name: 'denied', expectedVersion: 1 }),
      403,
      'FORBIDDEN',
    );
    await t.context.database.db
      .update(roles)
      .set({ permissions: DEFAULT_EVERYONE_PERMISSIONS | Permission.MANAGE_CHANNELS })
      .where(eq(roles.id, BigInt(f.guild.id)));
    const created = await request('POST', f.path, { type: 'announcement', name: 'news' });
    expect(created.statusCode, created.body).toBe(201);
    const channel = guildChannelSchema.parse(created.json());
    expect(
      (await request('PATCH', `${f.path}/${channel.id}`, { name: 'updates', expectedVersion: 1 }))
        .statusCode,
    ).toBe(200);
    await t.context.database.db
      .update(roles)
      .set({ permissions: DEFAULT_EVERYONE_PERMISSIONS })
      .where(eq(roles.id, BigInt(f.guild.id)));
    expectError(
      await request('PATCH', `${f.path}/${channel.id}`, { name: 'revoked', expectedVersion: 2 }),
      403,
      'FORBIDDEN',
    );
  });

  it('hides denied channels and keeps guild channels out of private metadata', async () => {
    const f = await fixture();
    await t.context.database.db.insert(channelOverwrites).values({
      channelId: BigInt(f.general.id),
      targetType: 'member',
      targetId: BigInt(f.member.user.id),
      deny: Permission.VIEW_CHANNEL,
    });
    const list = await t.request({ method: 'GET', url: f.path, headers: bearer(f.member) });
    expect(guildChannelListSchema.parse(list.json()).items).toEqual([]);
    expectError(
      await t.request({
        method: 'PATCH',
        url: `${f.path}/${f.general.id}`,
        headers: bearer(f.member),
        payload: { name: 'hidden', expectedVersion: 1 },
      }),
      404,
      'NOT_FOUND',
    );
    for (const suffix of ['']) {
      expectError(
        await t.request({
          method: 'GET',
          url: `/api/v1/channels/${f.general.id}${suffix}`,
          headers: bearer(f.owner),
        }),
        404,
        'NOT_FOUND',
      );
    }
    const privateList = await t.request({
      method: 'GET',
      url: '/api/v1/users/@me/channels',
      headers: bearer(f.owner),
    });
    expect(privateList.json()).toMatchObject({ items: [] });
  });

  it('checks reorder permissions, versions and the guild in nested channel paths', async () => {
    const f = await fixture();
    const body = {
      expectedVersion: f.guild.version,
      items: [{ id: f.general.id, parentId: null, position: 0 }],
    };
    expectError(
      await t.request({
        method: 'PUT',
        url: `${f.path}/order`,
        headers: bearer(f.member),
        payload: body,
      }),
      403,
      'FORBIDDEN',
    );
    expect(
      (
        await t.request({
          method: 'PUT',
          url: `${f.path}/order`,
          headers: bearer(f.owner),
          payload: body,
        })
      ).statusCode,
    ).toBe(200);
    expectError(
      await t.request({
        method: 'PUT',
        url: `${f.path}/order`,
        headers: bearer(f.owner),
        payload: body,
      }),
      409,
      'CONFLICT',
    );
    const other = await t.services.guilds.create(t.services.db, BigInt(f.owner.user.id), {
      name: 'Other',
    });
    expectError(
      await t.request({
        method: 'PATCH',
        url: `/api/v1/guilds/${other.id}/channels/${f.general.id}`,
        headers: bearer(f.owner),
        payload: { name: 'foreign', expectedVersion: 1 },
      }),
      404,
      'NOT_FOUND',
    );
  });
});
