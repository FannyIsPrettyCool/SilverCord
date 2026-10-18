import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Executor } from '../../db/executor.ts';
import { guildMembers, guilds, memberRoles } from './guilds-schema.ts';

/**
 * Read-only membership questions other modules ask about guilds (profiles audiences, profile
 * fan-out). Unlocked: callers re-evaluate on every request.
 */
export function createGuildMembership() {
  const other = alias(guildMembers, 'other_member');
  return {
    async isMember(ex: Executor, guildId: bigint, userId: bigint): Promise<boolean> {
      const [row] = await ex
        .select({ userId: guildMembers.userId })
        .from(guildMembers)
        .where(and(eq(guildMembers.guildId, guildId), eq(guildMembers.userId, userId)))
        .limit(1);
      return row !== undefined;
    },

    /** Guilds both users belong to, oldest first, with the total count. */
    async shared(ex: Executor, a: bigint, b: bigint, limit: number) {
      const rows = await ex
        .select({ guildId: guildMembers.guildId, total: sql<number>`count(*) over ()::int` })
        .from(guildMembers)
        .innerJoin(other, and(eq(other.guildId, guildMembers.guildId), eq(other.userId, b)))
        .where(eq(guildMembers.userId, a))
        .orderBy(asc(guildMembers.guildId))
        .limit(limit);
      return { count: rows[0]?.total ?? 0, ids: rows.map((row) => row.guildId) };
    },

    /** The subset of `candidates` sharing at least one guild with `userId`. */
    async coMembersAmong(
      ex: Executor,
      userId: bigint,
      candidates: readonly bigint[],
    ): Promise<Set<bigint>> {
      const others = candidates.filter((id) => id !== userId);
      if (others.length === 0) return new Set();
      const rows = await ex
        .selectDistinct({ userId: other.userId })
        .from(guildMembers)
        .innerJoin(other, eq(other.guildId, guildMembers.guildId))
        .where(and(eq(guildMembers.userId, userId), inArray(other.userId, others)));
      return new Set(rows.map((row) => row.userId));
    },

    /** Everyone sharing a guild with `userId` (bounded), for invalidation fan-out. */
    async coMemberIds(ex: Executor, userId: bigint, limit: number): Promise<bigint[]> {
      const rows = await ex
        .selectDistinct({ userId: other.userId })
        .from(guildMembers)
        .innerJoin(other, eq(other.guildId, guildMembers.guildId))
        .where(and(eq(guildMembers.userId, userId), ne(other.userId, userId)))
        .limit(limit);
      return rows.map((row) => row.userId);
    },

    async member(ex: Executor, guildId: bigint, userId: bigint) {
      const [row] = await ex
        .select()
        .from(guildMembers)
        .where(and(eq(guildMembers.guildId, guildId), eq(guildMembers.userId, userId)))
        .limit(1);
      if (!row) return undefined;
      const roles = await ex
        .select({ roleId: memberRoles.roleId })
        .from(memberRoles)
        .where(and(eq(memberRoles.guildId, guildId), eq(memberRoles.userId, userId)))
        .orderBy(asc(memberRoles.roleId));
      return { ...row, roleIds: roles.map((role) => role.roleId) };
    },

    /** The user's guilds (id and name), oldest first. */
    async guildsOf(ex: Executor, userId: bigint) {
      return ex
        .select({ id: guilds.id, name: guilds.name })
        .from(guildMembers)
        .innerJoin(guilds, eq(guilds.id, guildMembers.guildId))
        .where(eq(guildMembers.userId, userId))
        .orderBy(asc(guilds.id));
    },

    /** Member ids of one guild (bounded), for invalidations. */
    async memberIds(ex: Executor, guildId: bigint, limit = 5_000): Promise<bigint[]> {
      const rows = await ex
        .select({ id: guildMembers.userId })
        .from(guildMembers)
        .where(eq(guildMembers.guildId, guildId))
        .limit(limit);
      return rows.map((row) => row.id);
    },

    async ownsGuild(ex: Executor, userId: bigint): Promise<boolean> {
      const [row] = await ex
        .select({ id: guilds.id })
        .from(guilds)
        .where(eq(guilds.ownerId, userId))
        .limit(1);
      return row !== undefined;
    },

    async setNickname(ex: Executor, guildId: bigint, userId: bigint, nickname: string | null) {
      await ex
        .update(guildMembers)
        .set({ nickname })
        .where(and(eq(guildMembers.guildId, guildId), eq(guildMembers.userId, userId)));
    },

    async nicknames(ex: Executor, guildId: bigint, userIds: readonly bigint[]) {
      if (userIds.length === 0) return new Map<bigint, string | null>();
      const rows = await ex
        .select({ userId: guildMembers.userId, nickname: guildMembers.nickname })
        .from(guildMembers)
        .where(and(eq(guildMembers.guildId, guildId), inArray(guildMembers.userId, [...userIds])));
      return new Map(rows.map((row) => [row.userId, row.nickname]));
    },
  };
}
export type GuildMembership = ReturnType<typeof createGuildMembership>;
