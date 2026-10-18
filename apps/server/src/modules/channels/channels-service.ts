import type { ChannelPatch, OpenChannelRequest, PublicUser } from '@silvercord/protocol';
import type { Executor, Transaction } from '../../db/executor.ts';
import type { EventOutbox } from '../../events/outbox.ts';
import { AppError } from '../../http/app-error.ts';
import type { RelationshipsService } from '../relationships/relationships-service.ts';
import type { UsersService } from '../users/users-service.ts';
import { channelsRepository as repo } from './channels-repository.ts';
import type { ChannelRow } from './channels-schema.ts';

export interface ChannelsDependencies {
  readonly users: UsersService;
  readonly relationships: RelationshipsService;
  readonly outbox: EventOutbox;
  readonly nextId: () => bigint;
  readonly groupMaxMembers: number;
  /**
   * Runs inside the transaction that deletes a channel; returns work to do after commit
   * (e.g. removing stored objects whose rows the delete cascades away).
   */
  readonly onDelete?: (tx: Transaction, channelId: bigint) => Promise<() => Promise<void>>;
}

/** A channel row with its current public member cards. */
export interface ChannelBase {
  readonly row: Pick<
    ChannelRow,
    'id' | 'type' | 'ownerId' | 'name' | 'version' | 'lastMessageId' | 'createdAt'
  >;
  readonly members: PublicUser[];
}

/** Locked channel context for a write by a current member. */
export interface SendContext {
  readonly channel: ChannelRow;
  readonly memberIds: bigint[];
}

const notFound = () => new AppError('NOT_FOUND', 'Channel not found');
const MEMBERSHIP_RETRIES = 3;

/**
 * Owns private channel membership and recipient selection (docs/spec/messaging.md). Lock order:
 * social_privacy rows ascending, then the channel row, then message rows.
 */
export function createChannelsService(deps: ChannelsDependencies) {
  const { relationships, outbox } = deps;

  async function cards(ex: Executor, ids: readonly bigint[]): Promise<Map<string, PublicUser>> {
    return new Map((await deps.users.findPublicByIds(ex, ids)).map((user) => [user.id, user]));
  }

  async function withMembers(
    ex: Executor,
    rows: readonly ChannelBase['row'][],
  ): Promise<ChannelBase[]> {
    const memberships = await repo.membersOf(
      ex,
      rows.map((row) => row.id),
    );
    const userCards = await cards(
      ex,
      memberships.map((membership) => membership.userId),
    );
    return rows.map((row) => ({
      row,
      members: memberships.flatMap((membership) => {
        const card =
          membership.channelId === row.id ? userCards.get(membership.userId.toString()) : undefined;
        return card ? [card] : [];
      }),
    }));
  }

  async function requireMember(
    ex: Executor,
    channelId: bigint,
    userId: bigint,
    lock?: 'update' | 'share',
  ): Promise<ChannelRow> {
    const channel = await repo.find(ex, channelId, lock);
    if (
      !channel ||
      (channel.type !== 'dm' && channel.type !== 'group_dm') ||
      !(await repo.isMember(ex, channelId, userId))
    )
      throw notFound();
    return channel;
  }

  async function announce(tx: Transaction, channelId: bigint, recipients: readonly bigint[]) {
    await outbox.enqueue(tx, 'CHANNEL_CHANGED', recipients, { channelId: channelId.toString() });
  }

  async function openDm(tx: Transaction, actorId: bigint, recipientId: bigint): Promise<bigint> {
    if (actorId === recipientId) throw new AppError('NOT_FOUND', 'User unavailable');
    const existing = await repo.dmChannel(tx, actorId, recipientId);
    if ((await relationships.lockSocial(tx, [actorId, recipientId])) !== 2)
      throw new AppError('NOT_FOUND', 'User unavailable');
    // Existing history stays readable, but reopening still needs current permission to send.
    if (!(await relationships.canDirectMessage(tx, actorId, recipientId)))
      throw new AppError('NOT_FOUND', 'User unavailable');
    if (existing) return existing;
    const channelId = await repo.createDm(tx, deps.nextId(), actorId, recipientId);
    await announce(tx, channelId, [actorId, recipientId]);
    return channelId;
  }

  async function createGroup(
    tx: Transaction,
    actorId: bigint,
    recipientIds: readonly bigint[],
    name: string | null,
  ): Promise<bigint> {
    const others = [...new Set(recipientIds)].filter((id) => id !== actorId);
    const memberIds = [actorId, ...others];
    if (others.length === 0 || memberIds.length > deps.groupMaxMembers)
      throw new AppError('VALIDATION_FAILED', 'Invalid group size', { field: 'recipientIds' });
    if ((await relationships.lockSocial(tx, memberIds)) !== memberIds.length)
      throw new AppError('NOT_FOUND', 'User unavailable');
    const friends = await relationships.friendIdsAmong(tx, actorId, others);
    if (others.some((id) => !friends.has(id)) || (await relationships.hasBlockAmong(tx, memberIds)))
      throw new AppError('NOT_FOUND', 'User unavailable');
    const channelId = deps.nextId();
    await repo.createGroup(tx, { id: channelId, ownerId: actorId, name, memberIds });
    await announce(tx, channelId, memberIds);
    return channelId;
  }

  async function view(ex: Executor, viewerId: bigint, channelId: bigint): Promise<ChannelBase> {
    const channel = await requireMember(ex, channelId, viewerId);
    const [base] = await withMembers(ex, [channel]);
    if (!base) throw notFound();
    return base;
  }

  return {
    requireMember,

    async open(ex: Executor, actorId: bigint, request: OpenChannelRequest): Promise<ChannelBase> {
      const channelId = await ex.transaction((tx) =>
        'recipientId' in request
          ? openDm(tx, actorId, BigInt(request.recipientId))
          : createGroup(tx, actorId, request.recipientIds.map(BigInt), request.name ?? null),
      );
      return view(ex, actorId, channelId);
    },

    view,

    async list(
      ex: Executor,
      viewerId: bigint,
      query: { before?: string | undefined; after?: string | undefined; limit: number },
    ): Promise<{ items: ChannelBase[]; nextBefore: string | null }> {
      const rows = await repo.listForUser(ex, viewerId, query);
      const hasMore = rows.length > query.limit;
      const selected = rows.slice(0, query.limit);
      if (query.after) selected.reverse();
      const items = await withMembers(ex, selected);
      const last = selected.at(-1);
      return { items, nextBefore: hasMore && !query.after && last ? last.id.toString() : null };
    },

    async rename(
      ex: Executor,
      actorId: bigint,
      channelId: bigint,
      patch: ChannelPatch,
    ): Promise<ChannelBase> {
      await ex.transaction(async (tx) => {
        const channel = await requireMember(tx, channelId, actorId, 'update');
        if (channel.type !== 'group_dm' || channel.ownerId !== actorId)
          throw new AppError('FORBIDDEN', 'Only the group owner can rename it');
        if (channel.version !== patch.expectedVersion)
          throw new AppError('CONFLICT', 'Channel changed; reload and retry');
        if (channel.name === patch.name) return;
        await repo.update(tx, channelId, { name: patch.name });
        await announce(tx, channelId, await repo.memberIds(tx, channelId));
      });
      return view(ex, actorId, channelId);
    },

    async addMember(ex: Executor, actorId: bigint, channelId: bigint, userId: bigint) {
      for (let attempt = 0; attempt < MEMBERSHIP_RETRIES; attempt += 1) {
        // Snapshot the roster unlocked, take social locks for roster + addition, then lock the
        // channel and restart if the roster moved: never take social locks after a channel lock.
        const snapshot = await repo.find(ex, channelId);
        if (!snapshot || !(await repo.isMember(ex, channelId, actorId))) throw notFound();
        if (snapshot.type !== 'group_dm')
          throw new AppError('FORBIDDEN', 'Direct messages cannot gain members');
        const roster = await repo.memberIds(ex, channelId);
        const done = await ex.transaction(async (tx) => {
          const involved = [...new Set([...roster, userId])];
          if ((await relationships.lockSocial(tx, involved)) !== involved.length)
            throw new AppError('NOT_FOUND', 'User unavailable');
          const channel = await requireMember(tx, channelId, actorId, 'update');
          const current = await repo.memberIds(tx, channelId);
          if (channel.version !== snapshot.version || current.join() !== roster.join())
            return false;
          if (current.includes(userId)) return true;
          if (current.length >= deps.groupMaxMembers)
            throw new AppError('CONFLICT', 'Group is full');
          const friends = await relationships.friendIdsAmong(tx, actorId, [userId]);
          const blocked = await relationships.blockedEitherWay(tx, userId, current);
          if (!friends.has(userId) || blocked.size > 0)
            throw new AppError('NOT_FOUND', 'User unavailable');
          await repo.addMember(tx, channelId, userId);
          await repo.update(tx, channelId, {});
          await announce(tx, channelId, [...current, userId]);
          return true;
        });
        if (done) return;
      }
      throw new AppError('CONFLICT', 'Group changed; retry');
    },

    async removeMember(ex: Executor, actorId: bigint, channelId: bigint, userId: bigint) {
      let afterCommit: (() => Promise<void>) | undefined;
      await ex.transaction(async (tx) => {
        const channel = await requireMember(tx, channelId, actorId, 'update');
        if (channel.type !== 'group_dm')
          throw new AppError('FORBIDDEN', 'Direct messages cannot lose members');
        if (userId !== actorId && channel.ownerId !== actorId)
          throw new AppError('FORBIDDEN', 'Only the group owner can remove members');
        const current = await repo.memberIds(tx, channelId);
        if (!current.includes(userId)) throw new AppError('NOT_FOUND', 'Member not found');
        const remaining = current.filter((id) => id !== userId);
        if (remaining.length === 0) {
          afterCommit = await deps.onDelete?.(tx, channelId);
          await repo.delete(tx, channelId);
          await announce(tx, channelId, [userId]);
          return;
        }
        await repo.removeMember(tx, channelId, userId);
        // memberIds is ascending, so the smallest remaining id inherits ownership.
        const ownerId = channel.ownerId === userId ? (remaining[0] ?? null) : channel.ownerId;
        await repo.update(tx, channelId, { ownerId });
        await announce(tx, channelId, current);
      });
      await afterCommit?.();
    },

    /**
     * Locks a channel for a new message by a current member and re-checks DM privacy/blocks
     * under the social locks. Group sends need no social locks: blocks never deny group sends.
     */
    async lockForSend(tx: Transaction, channelId: bigint, senderId: bigint): Promise<SendContext> {
      const pair = await repo.dmPair(tx, channelId);
      if (pair) {
        if (senderId !== pair.userLow && senderId !== pair.userHigh) throw notFound();
        const recipientId = senderId === pair.userLow ? pair.userHigh : pair.userLow;
        await relationships.lockSocial(tx, [pair.userLow, pair.userHigh]);
        const channel = await requireMember(tx, channelId, senderId, 'update');
        if (!(await relationships.canDirectMessage(tx, senderId, recipientId)))
          throw new AppError('FORBIDDEN', 'You cannot message this user');
        return { channel, memberIds: [pair.userLow, pair.userHigh] };
      }
      const channel = await requireMember(tx, channelId, senderId, 'update');
      return { channel, memberIds: await repo.memberIds(tx, channelId) };
    },

    /** Whether a DM's peer currently accepts direct interaction from `userId`. */
    /** People sharing a DM or group with the user, for profile invalidation fan-out. */
    peerIds: (ex: Executor, userId: bigint, limit: number) => repo.peerIds(ex, userId, limit),
    async canInteract(ex: Executor, channelId: bigint, userId: bigint): Promise<boolean> {
      const pair = await repo.dmPair(ex, channelId);
      if (!pair) return true;
      const peer = userId === pair.userLow ? pair.userHigh : pair.userLow;
      return relationships.canDirectMessage(ex, userId, peer);
    },

    memberIds: (ex: Executor, channelId: bigint) => repo.memberIds(ex, channelId),
    setLastMessage: (ex: Executor, channelId: bigint, messageId: bigint) =>
      repo.setLastMessage(ex, channelId, messageId),
  };
}
export type ChannelsService = ReturnType<typeof createChannelsService>;
