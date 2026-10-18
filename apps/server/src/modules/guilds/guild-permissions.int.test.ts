import {
  ALL_PERMISSIONS,
  CHANNEL_SCOPE,
  DEFAULT_EVERYONE_PERMISSIONS,
  Permission,
} from '@silvercord/permissions';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase } from '../../../test/database.ts';
import { channelMembers, channelOverwrites, channels } from '../channels/channels-schema.ts';
import { users } from '../users/users-schema.ts';
import { createGuildPermissionsService } from './guild-permissions.ts';
import { guildBans, guildMembers, guilds, memberRoles, roles } from './guilds-schema.ts';

describe('authoritative guild permissions', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let sequence = 20_000n;
  const nextId = () => sequence++;
  const permissions = createGuildPermissionsService();
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(() => database.close());

  async function user() {
    const id = nextId();
    await database.db.insert(users).values({
      id,
      username: `perm${id}`,
      email: `perm${id}@example.test`,
      passwordHash: 'unused',
      locale: 'en',
      ageConfirmedAt: new Date(),
    });
    return id;
  }
  async function fixture() {
    const ownerId = await user();
    const memberId = await user();
    const outsiderId = await user();
    const guildId = nextId();
    const channelId = nextId();
    const roleId = nextId();
    await database.db.insert(guilds).values({ id: guildId, name: 'Permissions', ownerId });
    await database.db.insert(guildMembers).values([
      { guildId, userId: ownerId },
      { guildId, userId: memberId },
    ]);
    await database.db.insert(roles).values([
      {
        id: guildId,
        guildId,
        name: '@everyone',
        position: 0,
        permissions: DEFAULT_EVERYONE_PERMISSIONS,
      },
      {
        id: roleId,
        guildId,
        name: 'Manager',
        position: 1,
        permissions: Permission.MANAGE_CHANNELS,
      },
    ]);
    await database.db
      .insert(channels)
      .values({ id: channelId, guildId, type: 'guild_text', name: 'general' });
    return { ownerId, memberId, outsiderId, guildId, channelId, roleId };
  }

  it('hides unknown resources, nonmembers and members with a current ban', async () => {
    const f = await fixture();
    expect(await permissions.guild(database.db, f.guildId, f.outsiderId)).toEqual({
      visible: false,
      permissions: 0n,
    });
    expect(await permissions.channel(database.db, f.channelId, f.outsiderId)).toEqual({
      visible: false,
      permissions: 0n,
    });
    expect(await permissions.guild(database.db, 1n, f.memberId)).toEqual({
      visible: false,
      permissions: 0n,
    });
    await database.db.insert(guildBans).values({ guildId: f.guildId, userId: f.memberId });
    expect((await permissions.channel(database.db, f.channelId, f.memberId)).visible).toBe(false);
  });

  it('rechecks role assignments and membership instead of caching grants', async () => {
    const f = await fixture();
    await database.db
      .insert(memberRoles)
      .values({ guildId: f.guildId, userId: f.memberId, roleId: f.roleId });
    await expect(
      permissions.requireChannel(database.db, f.channelId, f.memberId, Permission.MANAGE_CHANNELS),
    ).resolves.toBeUndefined();
    await database.db
      .delete(memberRoles)
      .where(and(eq(memberRoles.guildId, f.guildId), eq(memberRoles.userId, f.memberId)));
    await expect(
      permissions.requireChannel(database.db, f.channelId, f.memberId, Permission.MANAGE_CHANNELS),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await database.db
      .delete(guildMembers)
      .where(and(eq(guildMembers.guildId, f.guildId), eq(guildMembers.userId, f.memberId)));
    await expect(
      permissions.requireChannel(database.db, f.channelId, f.memberId, Permission.VIEW_CHANNEL),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('resolves overwrites, implicit visibility and owner bypass from stored state', async () => {
    const f = await fixture();
    await database.db.insert(channelOverwrites).values({
      channelId: f.channelId,
      targetType: 'role',
      targetId: f.guildId,
      deny: Permission.VIEW_CHANNEL,
    });
    expect(await permissions.channel(database.db, f.channelId, f.memberId)).toEqual({
      visible: false,
      permissions: 0n,
    });
    expect(await permissions.channel(database.db, f.channelId, f.ownerId)).toEqual({
      visible: true,
      permissions: ALL_PERMISSIONS & CHANNEL_SCOPE,
    });
    await database.db.insert(channelOverwrites).values({
      channelId: f.channelId,
      targetType: 'member',
      targetId: f.memberId,
      allow: Permission.VIEW_CHANNEL,
    });
    expect((await permissions.channel(database.db, f.channelId, f.memberId)).visible).toBe(true);
  });

  it('uses the database clock for timeouts and denies sends despite overwrite allows', async () => {
    const f = await fixture();
    await database.db
      .update(guildMembers)
      .set({ timeoutUntil: new Date(Date.now() + 60_000) })
      .where(and(eq(guildMembers.guildId, f.guildId), eq(guildMembers.userId, f.memberId)));
    await database.db.insert(channelOverwrites).values({
      channelId: f.channelId,
      targetType: 'member',
      targetId: f.memberId,
      allow: Permission.SEND_MESSAGES,
    });
    expect(await permissions.channel(database.db, f.channelId, f.memberId)).toEqual({
      visible: true,
      permissions: Permission.VIEW_CHANNEL | Permission.READ_MESSAGE_HISTORY,
    });
    await database.db
      .update(guildMembers)
      .set({ timeoutUntil: new Date(0) })
      .where(and(eq(guildMembers.guildId, f.guildId), eq(guildMembers.userId, f.memberId)));
    await expect(
      permissions.requireChannel(database.db, f.channelId, f.memberId, Permission.SEND_MESSAGES),
    ).resolves.toBeUndefined();
  });

  it('keeps private conversations membership based and fails closed on unsupported masks', async () => {
    const f = await fixture();
    const dmId = nextId();
    await database.db.insert(channels).values({ id: dmId, type: 'dm' });
    await database.db.insert(channelMembers).values({ channelId: dmId, userId: f.memberId });
    expect((await permissions.channel(database.db, dmId, f.memberId)).visible).toBe(true);
    expect((await permissions.channel(database.db, dmId, f.ownerId)).visible).toBe(false);
    await database.db
      .update(roles)
      .set({ permissions: 1n << 40n })
      .where(eq(roles.id, f.guildId));
    await expect(permissions.guild(database.db, f.guildId, f.ownerId)).rejects.toMatchObject({
      code: 'INTERNAL',
    });
  });
});
