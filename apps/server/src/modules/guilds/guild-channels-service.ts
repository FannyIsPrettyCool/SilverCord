import { Permission } from '@silvercord/permissions';
import {
  GUILD_CHANNEL_LIMIT,
  type GuildChannel,
  type GuildChannelCreate,
  type GuildChannelOrder,
  type GuildChannelPatch,
  type ReadStateView,
} from '@silvercord/protocol';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Executor, Transaction } from '../../db/executor.ts';
import type { EventOutbox } from '../../events/outbox.ts';
import { AppError } from '../../http/app-error.ts';
import type { PermissionAccess } from '../../http/permissions.ts';
import { type ChannelRow, channelOverwrites, channels } from '../channels/channels-schema.ts';
import type { GuildPermissionsService } from './guild-permissions.ts';
import { auditLog, guildMembers, guilds } from './guilds-schema.ts';

interface Dependencies {
  readonly nextId: () => bigint;
  readonly outbox: EventOutbox;
  readonly permissions: GuildPermissionsService;
  readonly readStates?: (
    ex: Executor,
    userId: bigint,
    channelIds: readonly bigint[],
  ) => Promise<Map<bigint, ReadStateView>>;
}
const notFound = () => new AppError('NOT_FOUND', 'Channel not found');
const conflict = () => new AppError('CONFLICT', 'Channels changed; reload and retry');

/** Guild lock precedes channel locks and fresh permission checks on every mutation. */
export function createGuildChannelsService(deps: Dependencies) {
  async function lockGuild(tx: Transaction, guildId: bigint) {
    const [guild] = await tx
      .select({ id: guilds.id, version: guilds.version })
      .from(guilds)
      .where(eq(guilds.id, guildId))
      .for('update');
    if (!guild) throw new AppError('NOT_FOUND', 'Server not found');
    return guild;
  }
  async function rows(ex: Executor, guildId: bigint) {
    return ex
      .select()
      .from(channels)
      .where(eq(channels.guildId, guildId))
      .orderBy(asc(channels.position), asc(channels.id));
  }
  async function present(
    ex: Executor,
    viewerId: bigint,
    row: ChannelRow,
    knownAccess?: PermissionAccess,
    knownParentAccess?: PermissionAccess,
  ): Promise<GuildChannel | null> {
    if (row.guildId === null || row.name === null || row.type === 'dm' || row.type === 'group_dm')
      return null;
    const access = knownAccess ?? (await deps.permissions.channel(ex, row.id, viewerId));
    if (!access.visible) return null;
    const parentAccess =
      row.parentId === null
        ? null
        : (knownParentAccess ?? (await deps.permissions.channel(ex, row.parentId, viewerId)));
    return {
      id: row.id.toString(),
      guildId: row.guildId.toString(),
      type: row.type,
      name: row.name,
      parentId: parentAccess?.visible ? (row.parentId?.toString() ?? null) : null,
      position: row.position,
      topic: row.topic,
      archived: row.archived,
      version: row.version,
      lastMessageId: row.lastMessageId?.toString() ?? null,
      permissions: access.permissions.toString(),
      createdAt: row.createdAt.toISOString(),
    };
  }
  async function announce(
    tx: Transaction,
    guildId: bigint,
    actorId: bigint,
    action: string,
    targetId: bigint,
    changes: Record<string, unknown>,
  ) {
    await tx
      .update(guilds)
      .set({ version: sql`${guilds.version} + 1` })
      .where(eq(guilds.id, guildId));
    await tx.insert(auditLog).values({
      id: deps.nextId(),
      guildId,
      actorId,
      action,
      targetType: action === 'CHANNEL_REORDER' ? 'guild' : 'channel',
      targetId,
      changes,
    });
    const members = await tx
      .select({ id: guildMembers.userId })
      .from(guildMembers)
      .where(eq(guildMembers.guildId, guildId));
    await deps.outbox.enqueue(
      tx,
      'GUILD_CHANGED',
      members.map(({ id }) => id),
      { guildId: guildId.toString() },
    );
  }
  async function find(ex: Executor, guildId: bigint, channelId: bigint) {
    const [row] = await ex
      .select()
      .from(channels)
      .where(and(eq(channels.id, channelId), eq(channels.guildId, guildId)));
    if (!row) throw notFound();
    return row;
  }
  async function category(ex: Executor, guildId: bigint, parentId: bigint, viewerId: bigint) {
    const row = await find(ex, guildId, parentId);
    await deps.permissions.requireChannel(
      ex,
      parentId,
      viewerId,
      Permission.VIEW_CHANNEL | Permission.MANAGE_CHANNELS,
    );
    if (row.type !== 'guild_category')
      throw new AppError('VALIDATION_FAILED', 'Parent must be a category', { field: 'parentId' });
  }
  async function list(ex: Executor, viewerId: bigint, guildId: bigint): Promise<GuildChannel[]> {
    return ex.transaction(
      async (tx) => {
        await deps.permissions.requireGuild(tx, guildId, viewerId, 0n);
        const access = await deps.permissions.guildChannels(tx, guildId, viewerId);
        const visible: GuildChannel[] = [];
        for (const row of await rows(tx, guildId)) {
          const channel = await present(
            tx,
            viewerId,
            row,
            access.get(row.id) ?? { visible: false, permissions: 0n },
            row.parentId === null
              ? undefined
              : (access.get(row.parentId) ?? { visible: false, permissions: 0n }),
          );
          if (channel) visible.push(channel);
        }
        if (!deps.readStates) return visible;
        const readable = visible.filter(
          (item) => (BigInt(item.permissions) & Permission.READ_MESSAGE_HISTORY) !== 0n,
        );
        const states = await deps.readStates(
          tx,
          viewerId,
          readable.map((item) => BigInt(item.id)),
        );
        return visible.map((item) => ({
          ...item,
          readState: states.get(BigInt(item.id)) ?? {
            lastReadMessageId: null,
            unreadCount: 0,
            mentionCount: 0,
          },
        }));
      },
      { isolationLevel: 'repeatable read' },
    );
  }

  return {
    list,
    async createDefaultChannel(tx: Transaction, guildId: bigint): Promise<void> {
      await tx
        .insert(channels)
        .values({ id: deps.nextId(), guildId, type: 'guild_text', name: 'general' });
    },
    async create(
      ex: Executor,
      actorId: bigint,
      guildId: bigint,
      input: GuildChannelCreate,
    ): Promise<GuildChannel> {
      return ex.transaction(async (tx) => {
        await lockGuild(tx, guildId);
        await deps.permissions.requireGuild(tx, guildId, actorId, Permission.MANAGE_CHANNELS);
        const current = await rows(tx, guildId);
        if (current.length >= GUILD_CHANNEL_LIMIT)
          throw new AppError('CONFLICT', 'Server channel limit reached');
        const parentId = input.parentId ? BigInt(input.parentId) : null;
        if (input.type === 'guild_category' && parentId !== null)
          throw new AppError('VALIDATION_FAILED', 'Categories cannot have parents', {
            field: 'parentId',
          });
        if (parentId !== null) await category(tx, guildId, parentId, actorId);
        const position =
          Math.max(
            -1,
            ...current.filter((row) => row.parentId === parentId).map((row) => row.position),
          ) + 1;
        const id = deps.nextId();
        const [row] = await tx
          .insert(channels)
          .values({
            id,
            guildId,
            parentId,
            position,
            type: input.type,
            name: input.name,
            topic: input.topic ?? null,
          })
          .returning();
        if (!row) throw new Error('channel insert returned no row');
        if (parentId !== null) {
          const inherited = await tx
            .select()
            .from(channelOverwrites)
            .where(eq(channelOverwrites.channelId, parentId));
          if (inherited.length)
            await tx
              .insert(channelOverwrites)
              .values(inherited.map((overwrite) => ({ ...overwrite, channelId: id })));
        }
        await announce(tx, guildId, actorId, 'CHANNEL_CREATE', id, {
          type: input.type,
          name: input.name,
          parentId: input.parentId ?? null,
        });
        const result = await present(tx, actorId, row);
        if (!result) throw notFound();
        return result;
      });
    },
    async patch(
      ex: Executor,
      actorId: bigint,
      guildId: bigint,
      channelId: bigint,
      input: GuildChannelPatch,
    ): Promise<GuildChannel> {
      return ex.transaction(async (tx) => {
        await lockGuild(tx, guildId);
        const row = await find(tx, guildId, channelId);
        await deps.permissions.requireChannel(
          tx,
          channelId,
          actorId,
          Permission.VIEW_CHANNEL | Permission.MANAGE_CHANNELS,
        );
        if (row.version !== input.expectedVersion) throw conflict();
        const changes = {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.topic === undefined ? {} : { topic: input.topic }),
        };
        const [updated] = await tx
          .update(channels)
          .set({ ...changes, version: row.version + 1, updatedAt: sql`now()` })
          .where(eq(channels.id, channelId))
          .returning();
        if (!updated) throw notFound();
        await announce(tx, guildId, actorId, 'CHANNEL_UPDATE', channelId, changes);
        const result = await present(tx, actorId, updated);
        if (!result) throw notFound();
        return result;
      });
    },
    async reorder(
      ex: Executor,
      actorId: bigint,
      guildId: bigint,
      input: GuildChannelOrder,
    ): Promise<GuildChannel[]> {
      return ex.transaction(async (tx) => {
        const guild = await lockGuild(tx, guildId);
        await deps.permissions.requireGuild(tx, guildId, actorId, Permission.MANAGE_CHANNELS);
        if (guild.version !== input.expectedVersion) throw conflict();
        const current = await rows(tx, guildId);
        if (current.length !== input.items.length) throw conflict();
        const byId = new Map(current.map((row) => [row.id.toString(), row]));
        const ids = new Set<string>();
        const positions = new Set<string>();
        for (const item of input.items) {
          const row = byId.get(item.id);
          if (!row || ids.has(item.id)) throw conflict();
          ids.add(item.id);
          const key = `${item.parentId ?? 'root'}:${item.position}`;
          if (positions.has(key))
            throw new AppError('VALIDATION_FAILED', 'Duplicate channel positions');
          positions.add(key);
          await deps.permissions.requireChannel(
            tx,
            row.id,
            actorId,
            Permission.VIEW_CHANNEL | Permission.MANAGE_CHANNELS,
          );
          if (row.type === 'thread')
            throw new AppError('VALIDATION_FAILED', 'Threads cannot be reordered');
          if (row.type === 'guild_category' && item.parentId !== null)
            throw new AppError('VALIDATION_FAILED', 'Categories cannot have parents');
          if (item.parentId !== null) {
            const parent = byId.get(item.parentId);
            if (parent?.type !== 'guild_category')
              throw new AppError('VALIDATION_FAILED', 'Parent must be a category');
          }
        }
        const siblings = new Map<string, number[]>();
        for (const item of input.items) {
          const key = item.parentId ?? 'root';
          const values = siblings.get(key) ?? [];
          values.push(item.position);
          siblings.set(key, values);
        }
        for (const values of siblings.values()) {
          values.sort((a, b) => a - b);
          if (values.some((position, index) => position !== index))
            throw new AppError('VALIDATION_FAILED', 'Channel positions must be consecutive');
        }
        for (const item of input.items) {
          await tx
            .update(channels)
            .set({
              parentId: item.parentId ? BigInt(item.parentId) : null,
              position: item.position,
              version: sql`${channels.version} + 1`,
              updatedAt: sql`now()`,
            })
            .where(eq(channels.id, BigInt(item.id)));
        }
        await announce(tx, guildId, actorId, 'CHANNEL_REORDER', guildId, { order: input.items });
        return list(tx, actorId, guildId);
      });
    },
  };
}
export type GuildChannelsService = ReturnType<typeof createGuildChannelsService>;
