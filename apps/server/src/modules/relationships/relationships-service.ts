import type {
  PublicUser,
  RelationshipKind,
  RelationshipListQuery,
  RelationshipMetadata,
  RelationshipPage,
  RelationshipView,
  SocialPrivacy,
  SocialPrivacyPatch,
} from '@silvercord/protocol';
import type { Executor } from '../../db/executor.ts';
import type { EventOutbox } from '../../events/outbox.ts';
import { AppError } from '../../http/app-error.ts';
import type { UsersService } from '../users/users-service.ts';
import { type PairRow, relationshipsRepository as repo } from './relationships-repository.ts';

export interface RelationshipsDependencies {
  readonly users: UsersService;
  readonly nextId: () => bigint;
  readonly outbox: EventOutbox;
}

const unavailable = () => new AppError('NOT_FOUND', 'Relationship unavailable');
const privacyView = (row: SocialPrivacy): SocialPrivacy => ({
  friendRequests: row.friendRequests,
  directMessages: row.directMessages,
  version: row.version,
});

/** All policy checks and writes share ordered social locks, including composed transactions. */
export function createRelationshipsService({ users, nextId, outbox }: RelationshipsDependencies) {
  async function lockPair(ex: Executor, ownerId: bigint, targetId: bigint) {
    if (ownerId === targetId) throw unavailable();
    const rows = await repo.lockPrivacy(ex, [ownerId, targetId]);
    const target = rows.find((row) => row.userId === targetId);
    if (rows.length !== 2 || !target) throw unavailable();
    return target;
  }
  async function view(
    ex: Executor,
    ownerId: bigint,
    pair: PairRow,
    user: PublicUser,
  ): Promise<RelationshipView> {
    return {
      id: pair.id.toString(),
      user,
      version: pair.version,
      kind:
        pair.state === 'friends'
          ? 'friends'
          : pair.requestedBy === ownerId
            ? 'outgoing'
            : 'incoming',
      metadata: await repo.metadata(ex, ownerId, BigInt(user.id)),
    };
  }
  async function targetUser(ex: Executor, targetId: bigint) {
    const [user] = await users.findPublicByIds(ex, [targetId]);
    if (!user) throw unavailable();
    return user;
  }

  /**
   * Subjects whose presence the viewer may see: accepted friends with no block either way.
   * Read-only and unlocked; callers re-evaluate on every snapshot.
   */
  async function presenceVisible(
    ex: Executor,
    viewerId: bigint,
    subjectIds: readonly bigint[],
  ): Promise<Set<bigint>> {
    const others = subjectIds.filter((id) => id !== viewerId);
    const friends = await repo.friendIds(ex, viewerId, others);
    const blocked = new Set(await repo.blockedEitherWay(ex, viewerId, friends));
    const visible = new Set(friends.filter((id) => !blocked.has(id)));
    if (subjectIds.includes(viewerId)) visible.add(viewerId);
    return visible;
  }

  return {
    async request(ex: Executor, ownerId: bigint, username: string): Promise<RelationshipView> {
      return ex.transaction(async (tx) => {
        const target = await users.findPublicByUsername(tx, username);
        if (!target) throw unavailable();
        const targetId = BigInt(target.id);
        const privacy = await lockPair(tx, ownerId, targetId);
        if ((await repo.blocks(tx, ownerId, targetId)).length) throw unavailable();
        let pair = await repo.pair(tx, ownerId, targetId);
        if (pair && pair.state !== 'none') return view(tx, ownerId, pair, target);
        if (privacy.friendRequests === 'nobody') throw unavailable();
        pair ??= await repo.ensurePair(tx, nextId(), ownerId, targetId);
        if (!pair) throw new Error('relationship pair missing');
        if (pair.state === 'none') {
          pair = await repo.setPair(tx, pair, 'pending', ownerId);
          await outbox.enqueue(tx, 'RELATIONSHIPS_CHANGED', [ownerId, targetId], {});
        }
        return view(tx, ownerId, pair, target);
      });
    },
    async accept(ex: Executor, ownerId: bigint, targetId: bigint): Promise<RelationshipView> {
      return ex.transaction(async (tx) => {
        await lockPair(tx, ownerId, targetId);
        const pair = await repo.pair(tx, ownerId, targetId);
        if (
          pair?.state !== 'pending' ||
          pair.requestedBy !== targetId ||
          (await repo.blocks(tx, ownerId, targetId)).length
        )
          throw unavailable();
        const updated = await repo.setPair(tx, pair, 'friends');
        await outbox.enqueue(tx, 'RELATIONSHIPS_CHANGED', [ownerId, targetId], {});
        return view(tx, ownerId, updated, await targetUser(tx, targetId));
      });
    },
    async remove(ex: Executor, ownerId: bigint, targetId: bigint): Promise<void> {
      await ex.transaction(async (tx) => {
        await lockPair(tx, ownerId, targetId);
        const pair = await repo.pair(tx, ownerId, targetId);
        if (pair && pair.state !== 'none') {
          await repo.setPair(tx, pair, 'none');
          await outbox.enqueue(tx, 'RELATIONSHIPS_CHANGED', [ownerId, targetId], {});
        }
      });
    },
    async block(ex: Executor, ownerId: bigint, targetId: bigint): Promise<void> {
      await ex.transaction(async (tx) => {
        await lockPair(tx, ownerId, targetId);
        const inserted = await repo.block(tx, nextId(), ownerId, targetId);
        const pair = await repo.pair(tx, ownerId, targetId);
        const removed = pair && pair.state !== 'none';
        if (removed) await repo.setPair(tx, pair, 'none');
        if (inserted || removed)
          await outbox.enqueue(tx, 'RELATIONSHIPS_CHANGED', [ownerId, targetId], {});
      });
    },
    async unblock(ex: Executor, ownerId: bigint, targetId: bigint): Promise<void> {
      await ex.transaction(async (tx) => {
        await lockPair(tx, ownerId, targetId);
        if (await repo.unblock(tx, ownerId, targetId))
          await outbox.enqueue(tx, 'RELATIONSHIPS_CHANGED', [ownerId], {});
      });
    },
    async list(
      ex: Executor,
      ownerId: bigint,
      query: RelationshipListQuery,
    ): Promise<RelationshipPage> {
      return ex.transaction(async (tx) => {
        const rows = await repo.list(tx, ownerId, query);
        const hasMore = rows.length > query.limit;
        const selected = rows.slice(0, query.limit);
        if (query.after) selected.reverse();
        const cards = new Map(
          (
            await users.findPublicByIds(
              tx,
              selected.map((row) => row.targetId),
            )
          ).map((user) => [user.id, user]),
        );
        const items: RelationshipView[] = selected.flatMap((row) => {
          const user = cards.get(row.targetId.toString());
          return user
            ? [
                {
                  id: row.id.toString(),
                  user,
                  kind: row.kind,
                  version: row.version,
                  metadata: { nickname: row.nickname, note: row.note },
                },
              ]
            : [];
        });
        return { items, nextBefore: hasMore && !query.after ? (items.at(-1)?.id ?? null) : null };
      });
    },
    async metadata(
      ex: Executor,
      ownerId: bigint,
      targetId: bigint,
      input: RelationshipMetadata,
    ): Promise<RelationshipMetadata> {
      return ex
        .transaction(async (tx) => {
          await lockPair(tx, ownerId, targetId);
          const pair = await repo.pair(tx, ownerId, targetId);
          const ownBlock = (await repo.blocks(tx, ownerId, targetId)).some(
            (block) => block.ownerId === ownerId,
          );
          if ((!pair || pair.state === 'none') && !ownBlock) throw unavailable();
          const existing = await repo.metadata(tx, ownerId, targetId);
          if (existing.nickname !== input.nickname || existing.note !== input.note) {
            await repo.setMetadata(tx, ownerId, targetId, input);
            await outbox.enqueue(tx, 'RELATIONSHIPS_CHANGED', [ownerId], {});
          }
          return input;
        })
        .catch((error: unknown) => {
          // Driver errors include SQL parameters, which contain the private note/nickname.
          // Never forward those error objects to the generic HTTP error logger.
          if (error instanceof AppError) throw error;
          throw new AppError('INTERNAL', 'Internal server error');
        });
    },
    async privacy(ex: Executor, ownerId: bigint): Promise<SocialPrivacy> {
      return ex.transaction(async (tx) => {
        const [row] = await repo.lockPrivacy(tx, [ownerId]);
        if (!row) throw unavailable();
        return privacyView(row);
      });
    },
    async setPrivacy(
      ex: Executor,
      ownerId: bigint,
      patch: SocialPrivacyPatch,
    ): Promise<SocialPrivacy> {
      return ex.transaction(async (tx) => {
        const [row] = await repo.lockPrivacy(tx, [ownerId]);
        if (!row) throw unavailable();
        if (
          (patch.friendRequests === undefined || patch.friendRequests === row.friendRequests) &&
          (patch.directMessages === undefined || patch.directMessages === row.directMessages)
        )
          return privacyView(row);
        const updated = await repo.setPrivacy(tx, ownerId, patch);
        await outbox.enqueue(tx, 'RELATIONSHIPS_CHANGED', [ownerId], {});
        return privacyView(updated);
      });
    },
    async canDirectMessage(ex: Executor, senderId: bigint, recipientId: bigint): Promise<boolean> {
      return ex.transaction(async (tx) => {
        if (senderId === recipientId) return false;
        const rows = await repo.lockPrivacy(tx, [senderId, recipientId]);
        if (
          rows.length !== 2 ||
          rows.find((row) => row.userId === recipientId)?.directMessages !== 'friends'
        )
          return false;
        return (
          (await repo.blocks(tx, senderId, recipientId)).length === 0 &&
          (await repo.pair(tx, senderId, recipientId))?.state === 'friends'
        );
      });
    },
    async canSeePresence(ex: Executor, viewerId: bigint, subjectId: bigint): Promise<boolean> {
      if (viewerId === subjectId) return true;
      return (await presenceVisible(ex, viewerId, [subjectId])).has(subjectId);
    },
    presenceVisible,
    /** Users who may currently see `subjectId`'s presence (for invalidation fan-out). */
    async presenceAudience(ex: Executor, subjectId: bigint): Promise<bigint[]> {
      const friends = await repo.friendIds(ex, subjectId);
      const blocked = new Set(await repo.blockedEitherWay(ex, subjectId, friends));
      return friends.filter((id) => !blocked.has(id));
    },
    /** Locks social rows in ascending id order; first step of every cross-user write. */
    async lockSocial(ex: Executor, userIds: readonly bigint[]): Promise<number> {
      return (await repo.lockPrivacy(ex, userIds)).length;
    },
    /** Users the viewer has blocked; their content is hidden from the viewer. */
    async blockedByViewer(ex: Executor, viewerId: bigint): Promise<Set<bigint>> {
      return new Set(await repo.blockedTargets(ex, viewerId));
    },
    async blockedEitherWay(ex: Executor, userId: bigint, others: readonly bigint[]) {
      return new Set(await repo.blockedEitherWay(ex, userId, others));
    },
    async hasBlockAmong(ex: Executor, userIds: readonly bigint[]): Promise<boolean> {
      return repo.anyBlockAmong(ex, userIds);
    },
    /**
     * The viewer's side of one pair for profile views: kind (`blocked` only for the viewer's own
     * block), whether either side blocks, and the viewer's private note.
     */
    async standing(ex: Executor, viewerId: bigint, targetId: bigint) {
      const blocks = viewerId === targetId ? [] : await repo.blocks(ex, viewerId, targetId);
      const pair = viewerId === targetId ? undefined : await repo.pair(ex, viewerId, targetId);
      const ownBlock = blocks.some((block) => block.ownerId === viewerId);
      const kind: RelationshipKind | 'none' = ownBlock
        ? 'blocked'
        : !pair || pair.state === 'none'
          ? 'none'
          : pair.state === 'friends'
            ? 'friends'
            : pair.requestedBy === viewerId
              ? 'outgoing'
              : 'incoming';
      const note =
        viewerId === targetId ? null : (await repo.metadata(ex, viewerId, targetId)).note;
      return { kind, blocked: blocks.length > 0, note };
    },
    async friendIdsAmong(
      ex: Executor,
      ownerId: bigint,
      candidates: readonly bigint[],
    ): Promise<Set<bigint>> {
      return new Set(await repo.friendIds(ex, ownerId, candidates));
    },
  };
}
export type RelationshipsService = ReturnType<typeof createRelationshipsService>;
