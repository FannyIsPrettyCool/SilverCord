import {
  ALL_PERMISSIONS,
  computeChannelPermissions,
  computeGuildPermissions,
  DIRECT_MESSAGE_PERMISSIONS,
  type GuildInput,
  has,
  type MemberInput,
  type Overwrite,
  Permission,
} from '@silvercord/permissions';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Executor } from '../../db/executor.ts';
import { AppError } from '../../http/app-error.ts';
import type { PermissionAccess } from '../../http/permissions.ts';
import {
  type ChannelRow,
  channelMembers,
  channelOverwrites,
  channels,
} from '../channels/channels-schema.ts';
import { guildBans, guildMembers, guilds, memberRoles, roles } from './guilds-schema.ts';

const HIDDEN: PermissionAccess = { visible: false, permissions: 0n };

function resolve(
  input: { guild: GuildInput; member: MemberInput },
  type: ChannelRow['type'],
  overwrites: readonly Overwrite[],
): PermissionAccess {
  const kind = {
    guild_text: 'text',
    guild_voice: 'voice',
    guild_category: 'category',
    announcement: 'announcement',
  } as const;
  // Thread access must resolve the parent's permissions in the later threads task.
  if (type === 'dm' || type === 'group_dm' || type === 'thread') return HIDDEN;
  const permissions = computeChannelPermissions(input.guild, input.member, {
    kind: kind[type],
    overwrites,
  });
  return { visible: has(permissions, Permission.VIEW_CHANNEL), permissions };
}

/**
 * Reads current database state, never a client bitfield or a cached membership. Mutations
 * acquire the guild row lock before this read so role/membership changes serialize with it.
 */
export function createGuildPermissionsService() {
  async function state(ex: Executor, guildId: bigint, userId: bigint) {
    const everyone = alias(roles, 'everyone');
    // One statement snapshots membership, timeout and all assigned roles together.
    const rows = await ex
      .select({
        ownerId: guilds.ownerId,
        everyonePermissions: everyone.permissions,
        timedOut: sql<boolean>`${guildMembers.timeoutUntil} > now()`,
        roleId: roles.id,
        rolePermissions: roles.permissions,
        rolePosition: roles.position,
      })
      .from(guilds)
      .innerJoin(
        guildMembers,
        and(eq(guildMembers.guildId, guilds.id), eq(guildMembers.userId, userId)),
      )
      .innerJoin(everyone, and(eq(everyone.guildId, guilds.id), eq(everyone.id, guilds.id)))
      .leftJoin(guildBans, and(eq(guildBans.guildId, guilds.id), eq(guildBans.userId, userId)))
      .leftJoin(
        memberRoles,
        and(eq(memberRoles.guildId, guilds.id), eq(memberRoles.userId, userId)),
      )
      .leftJoin(roles, and(eq(roles.guildId, guilds.id), eq(roles.id, memberRoles.roleId)))
      .where(and(eq(guilds.id, guildId), isNull(guildBans.userId)));
    const first = rows[0];
    if (!first) return null;
    const assigned = rows.flatMap((row) =>
      row.roleId === null || row.rolePermissions === null || row.rolePosition === null
        ? []
        : [
            {
              id: row.roleId.toString(),
              permissions: row.rolePermissions,
              position: row.rolePosition,
            },
          ],
    );
    if (
      (first.everyonePermissions & ~ALL_PERMISSIONS) !== 0n ||
      assigned.some((role) => (role.permissions & ~ALL_PERMISSIONS) !== 0n)
    ) {
      throw new AppError('INTERNAL', 'Authorization unavailable');
    }
    const guild: GuildInput = {
      ownerId: first.ownerId.toString(),
      everyone: { id: guildId.toString(), permissions: first.everyonePermissions, position: 0 },
      roles: new Map(assigned.map((role) => [role.id, role])),
    };
    const member: MemberInput = {
      userId: userId.toString(),
      roleIds: assigned.map((role) => role.id),
      timedOut: first.timedOut === true,
    };
    return { guild, member };
  }

  async function guild(ex: Executor, guildId: bigint, userId: bigint): Promise<PermissionAccess> {
    const input = await state(ex, guildId, userId);
    return input
      ? { visible: true, permissions: computeGuildPermissions(input.guild, input.member) }
      : HIDDEN;
  }

  async function channel(
    ex: Executor,
    channelId: bigint,
    userId: bigint,
  ): Promise<PermissionAccess> {
    const [row] = await ex.select().from(channels).where(eq(channels.id, channelId));
    if (!row) return HIDDEN;
    if (row.guildId === null) {
      const [member] = await ex
        .select({ userId: channelMembers.userId })
        .from(channelMembers)
        .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, userId)));
      return member ? { visible: true, permissions: DIRECT_MESSAGE_PERMISSIONS } : HIDDEN;
    }
    // Threads need their parent's overwrites as specified in ADR-0010. Their lifecycle and
    // parent resolution arrive with the threads task; do not accidentally expose them now.
    if (row.type === 'thread') return HIDDEN;
    const input = await state(ex, row.guildId, userId);
    if (!input) return HIDDEN;
    const overwrites = await ex
      .select()
      .from(channelOverwrites)
      .where(eq(channelOverwrites.channelId, channelId));
    return resolve(
      input,
      row.type,
      overwrites.map((overwrite) => ({
        type: overwrite.targetType,
        id: overwrite.targetId.toString(),
        allow: overwrite.allow,
        deny: overwrite.deny,
      })),
    );
  }

  /** A bounded number of queries for the entire channel sidebar, up to 500 channels. */
  async function guildChannels(ex: Executor, guildId: bigint, userId: bigint) {
    const input = await state(ex, guildId, userId);
    const result = new Map<bigint, PermissionAccess>();
    if (!input) return result;
    const rows = await ex.select().from(channels).where(eq(channels.guildId, guildId));
    const overwrites = await ex
      .select({
        channelId: channelOverwrites.channelId,
        targetType: channelOverwrites.targetType,
        targetId: channelOverwrites.targetId,
        allow: channelOverwrites.allow,
        deny: channelOverwrites.deny,
      })
      .from(channelOverwrites)
      .innerJoin(channels, eq(channels.id, channelOverwrites.channelId))
      .where(eq(channels.guildId, guildId));
    const byChannel = new Map<bigint, Overwrite[]>();
    for (const overwrite of overwrites) {
      const list = byChannel.get(overwrite.channelId) ?? [];
      list.push({
        type: overwrite.targetType,
        id: overwrite.targetId.toString(),
        allow: overwrite.allow,
        deny: overwrite.deny,
      });
      byChannel.set(overwrite.channelId, list);
    }
    for (const row of rows)
      result.set(row.id, resolve(input, row.type, byChannel.get(row.id) ?? []));
    return result;
  }

  function requireAccess(access: PermissionAccess, bits: bigint) {
    if (!access.visible) throw new AppError('NOT_FOUND', 'Resource not found');
    if (!has(access.permissions, bits)) throw new AppError('FORBIDDEN', 'Permission required');
  }

  return {
    guild,
    // Read requests combine role and overwrite statements in one snapshot. A mutation's
    // surrounding transaction instead holds the guild lock throughout authorization/write.
    channel: (ex: Executor, channelId: bigint, userId: bigint) =>
      ex.transaction((tx) => channel(tx, channelId, userId), { isolationLevel: 'repeatable read' }),
    guildChannels: (ex: Executor, guildId: bigint, userId: bigint) =>
      ex.transaction((tx) => guildChannels(tx, guildId, userId), {
        isolationLevel: 'repeatable read',
      }),
    async requireGuild(ex: Executor, guildId: bigint, userId: bigint, bits: bigint) {
      requireAccess(await guild(ex, guildId, userId), bits);
    },
    async requireChannel(ex: Executor, channelId: bigint, userId: bigint, bits: bigint) {
      await ex.transaction(
        async (tx) => requireAccess(await channel(tx, channelId, userId), bits),
        { isolationLevel: 'repeatable read' },
      );
    },
  };
}

export type GuildPermissionsService = ReturnType<typeof createGuildPermissionsService>;
