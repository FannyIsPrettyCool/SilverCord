import { DEFAULT_EVERYONE_PERMISSIONS, has, Permission } from '@silvercord/permissions';
import type { CreateGuildRequest, Guild, GuildPatch } from '@silvercord/protocol';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Executor, Transaction } from '../../db/executor.ts';
import type { EventOutbox } from '../../events/outbox.ts';
import { AppError } from '../../http/app-error.ts';
import { users } from '../users/users-schema.ts';
import type { GuildPermissionsService } from './guild-permissions.ts';
import { auditLog, guildMembers, guilds, roles } from './guilds-schema.ts';

export interface GuildsDependencies {
  readonly nextId: () => bigint;
  readonly outbox: EventOutbox;
  readonly permissions: GuildPermissionsService;
  readonly createDefaultChannel: (tx: Transaction, guildId: bigint) => Promise<void>;
}

const notFound = () => new AppError('NOT_FOUND', 'Server not found');

/** Guild rows serialize member/role changes; user rows serialize joined and owned caps. */
export function createGuildsService(deps: GuildsDependencies) {
  async function requireUser(tx: Transaction, userId: bigint) {
    const [user] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      // Serialize caps without blocking the FK key-share checks of guild mutations.
      .for('no key update');
    if (!user) throw notFound();
  }

  async function access(ex: Executor, guildId: bigint, userId: bigint, lock = false) {
    const query = ex.select().from(guilds).where(eq(guilds.id, guildId));
    const [guild] = await (lock ? query.for('update') : query);
    if (!guild) throw notFound();
    const access = await deps.permissions.guild(ex, guildId, userId);
    if (!access.visible) throw notFound();
    return { guild, permissions: access.permissions };
  }

  async function view(ex: Executor, userId: bigint, guildId: bigint): Promise<Guild> {
    const { guild, permissions } = await access(ex, guildId, userId);
    const [count] = await ex
      .select({ value: sql<number>`count(*)::int` })
      .from(guildMembers)
      .where(eq(guildMembers.guildId, guildId));
    return {
      id: guild.id.toString(),
      name: guild.name,
      ownerId: guild.ownerId.toString(),
      version: guild.version,
      memberCount: count?.value ?? 1,
      permissions: permissions.toString(),
      createdAt: guild.createdAt.toISOString(),
    };
  }

  async function announce(tx: Transaction, guildId: bigint, extra: readonly bigint[] = []) {
    const members = await tx
      .select({ id: guildMembers.userId })
      .from(guildMembers)
      .where(eq(guildMembers.guildId, guildId));
    await deps.outbox.enqueue(
      tx,
      'GUILD_CHANGED',
      [...members.map((member) => member.id), ...extra],
      { guildId: guildId.toString() },
    );
  }

  return {
    view,
    async list(ex: Executor, userId: bigint): Promise<Guild[]> {
      // An entire response sees the same member/role snapshot, including concurrent removals.
      return ex.transaction(
        async (tx) => {
          const memberships = await tx
            .select({ id: guildMembers.guildId })
            .from(guildMembers)
            .where(eq(guildMembers.userId, userId))
            .orderBy(desc(guildMembers.guildId));
          return Promise.all(memberships.map((member) => view(tx, userId, member.id)));
        },
        { isolationLevel: 'repeatable read' },
      );
    },
    async create(ex: Executor, actorId: bigint, request: CreateGuildRequest): Promise<Guild> {
      const guildId = deps.nextId();
      await ex.transaction(async (tx) => {
        await requireUser(tx, actorId);
        const [owned] = await tx
          .select({ value: sql<number>`count(*)::int` })
          .from(guilds)
          .where(eq(guilds.ownerId, actorId));
        const [joined] = await tx
          .select({ value: sql<number>`count(*)::int` })
          .from(guildMembers)
          .where(eq(guildMembers.userId, actorId));
        if ((owned?.value ?? 0) >= 25 || (joined?.value ?? 0) >= 100)
          throw new AppError('CONFLICT', 'Server limit reached');
        await tx.insert(guilds).values({ id: guildId, ownerId: actorId, name: request.name });
        await tx.insert(guildMembers).values({ guildId, userId: actorId });
        await tx.insert(roles).values({
          id: guildId,
          guildId,
          name: '@everyone',
          permissions: DEFAULT_EVERYONE_PERMISSIONS,
          position: 0,
        });
        await deps.createDefaultChannel(tx, guildId);
        await tx.insert(auditLog).values({
          id: deps.nextId(),
          guildId,
          actorId,
          action: 'GUILD_CREATE',
          targetType: 'guild',
          targetId: guildId,
          changes: { name: request.name },
        });
        await announce(tx, guildId);
      });
      return view(ex, actorId, guildId);
    },
    async rename(
      ex: Executor,
      actorId: bigint,
      guildId: bigint,
      patch: GuildPatch,
    ): Promise<Guild> {
      await ex.transaction(async (tx) => {
        const { guild, permissions } = await access(tx, guildId, actorId, true);
        if (!has(permissions, Permission.MANAGE_GUILD))
          throw new AppError('FORBIDDEN', 'Missing server permission');
        if (guild.version !== patch.expectedVersion)
          throw new AppError('CONFLICT', 'Server changed');
        await tx
          .update(guilds)
          .set({ name: patch.name, version: guild.version + 1 })
          .where(eq(guilds.id, guildId));
        await tx.insert(auditLog).values({
          id: deps.nextId(),
          guildId,
          actorId,
          action: 'GUILD_UPDATE',
          targetType: 'guild',
          targetId: guildId,
          changes: { name: { before: guild.name, after: patch.name } },
        });
        await announce(tx, guildId);
      });
      return view(ex, actorId, guildId);
    },
    async leave(ex: Executor, actorId: bigint, guildId: bigint): Promise<void> {
      await ex.transaction(async (tx) => {
        await requireUser(tx, actorId);
        const { guild } = await access(tx, guildId, actorId, true);
        if (guild.ownerId === actorId)
          throw new AppError('FORBIDDEN', 'Transfer ownership before leaving');
        await tx
          .delete(guildMembers)
          .where(and(eq(guildMembers.guildId, guildId), eq(guildMembers.userId, actorId)));
        await tx.insert(auditLog).values({
          id: deps.nextId(),
          guildId,
          actorId,
          action: 'MEMBER_LEAVE',
          targetType: 'user',
          targetId: actorId,
        });
        await announce(tx, guildId, [actorId]);
        const remaining = await tx
          .select({ id: guildMembers.userId })
          .from(guildMembers)
          .where(eq(guildMembers.guildId, guildId));
        await deps.outbox.enqueue(
          tx,
          'GUILD_MEMBERS_CHANGED',
          [...remaining.map((member) => member.id), actorId],
          { guildId: guildId.toString() },
        );
      });
    },
  };
}

export type GuildsService = ReturnType<typeof createGuildsService>;
