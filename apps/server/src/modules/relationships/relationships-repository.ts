import type {
  RelationshipKind,
  RelationshipListQuery,
  RelationshipMetadata,
  SocialPrivacyPatch,
} from '@silvercord/protocol';
import { and, asc, desc, eq, gt, inArray, lt, or, sql } from 'drizzle-orm';
import type { Executor } from '../../db/executor.ts';
import {
  relationshipMetadata,
  relationshipPairs,
  socialPrivacy,
  userBlocks,
} from './relationships-schema.ts';

export type PairRow = typeof relationshipPairs.$inferSelect;

const endpoints = (ownerId: bigint, targetId: bigint) => ({
  low: ownerId < targetId ? ownerId : targetId,
  high: ownerId < targetId ? targetId : ownerId,
});
const pairWhere = (ownerId: bigint, targetId: bigint) => {
  const { low, high } = endpoints(ownerId, targetId);
  return and(eq(relationshipPairs.userLow, low), eq(relationshipPairs.userHigh, high));
};

/** Mutating callers hold both privacy rows in ascending id order for the whole transaction. */
export const relationshipsRepository = {
  async lockPrivacy(ex: Executor, ids: readonly bigint[]) {
    return ex
      .select()
      .from(socialPrivacy)
      .where(inArray(socialPrivacy.userId, [...new Set(ids)]))
      .orderBy(asc(socialPrivacy.userId))
      .for('update');
  },
  async pair(ex: Executor, ownerId: bigint, targetId: bigint) {
    const [row] = await ex
      .select()
      .from(relationshipPairs)
      .where(pairWhere(ownerId, targetId))
      .limit(1);
    return row;
  },
  async ensurePair(ex: Executor, id: bigint, ownerId: bigint, targetId: bigint) {
    const { low, high } = endpoints(ownerId, targetId);
    await ex
      .insert(relationshipPairs)
      .values({ id, userLow: low, userHigh: high })
      .onConflictDoNothing();
    return this.pair(ex, ownerId, targetId);
  },
  async setPair(
    ex: Executor,
    pair: PairRow,
    state: PairRow['state'],
    requestedBy: bigint | null = null,
  ) {
    const [row] = await ex
      .update(relationshipPairs)
      .set({
        state,
        requestedBy,
        version: sql`${relationshipPairs.version} + 1`,
        updatedAt: sql`now()`,
      })
      .where(eq(relationshipPairs.id, pair.id))
      .returning();
    if (!row) throw new Error('relationship pair disappeared under lock');
    return row;
  },
  async blocks(ex: Executor, ownerId: bigint, targetId: bigint) {
    return ex
      .select()
      .from(userBlocks)
      .where(
        or(
          and(eq(userBlocks.ownerId, ownerId), eq(userBlocks.targetId, targetId)),
          and(eq(userBlocks.ownerId, targetId), eq(userBlocks.targetId, ownerId)),
        ),
      );
  },
  async blockedTargets(ex: Executor, ownerId: bigint): Promise<bigint[]> {
    const rows = await ex
      .select({ targetId: userBlocks.targetId })
      .from(userBlocks)
      .where(eq(userBlocks.ownerId, ownerId));
    return rows.map((row) => row.targetId);
  },
  /** Ids in `others` that block `userId` or are blocked by it. */
  async blockedEitherWay(ex: Executor, userId: bigint, others: readonly bigint[]) {
    if (others.length === 0) return [];
    const list = [...others];
    const rows = await ex
      .select({ ownerId: userBlocks.ownerId, targetId: userBlocks.targetId })
      .from(userBlocks)
      .where(
        or(
          and(eq(userBlocks.ownerId, userId), inArray(userBlocks.targetId, list)),
          and(eq(userBlocks.targetId, userId), inArray(userBlocks.ownerId, list)),
        ),
      );
    return rows.map((row) => (row.ownerId === userId ? row.targetId : row.ownerId));
  },
  async anyBlockAmong(ex: Executor, ids: readonly bigint[]): Promise<boolean> {
    if (ids.length < 2) return false;
    const list = [...ids];
    const [row] = await ex
      .select({ id: userBlocks.id })
      .from(userBlocks)
      .where(and(inArray(userBlocks.ownerId, list), inArray(userBlocks.targetId, list)))
      .limit(1);
    return row !== undefined;
  },
  /** Accepted friends of `ownerId`, optionally restricted to `candidates`. */
  async friendIds(ex: Executor, ownerId: bigint, candidates?: readonly bigint[]) {
    if (candidates?.length === 0) return [];
    const restrict = (column: typeof relationshipPairs.userLow) =>
      candidates ? inArray(column, [...candidates]) : undefined;
    const rows = await ex
      .select({ low: relationshipPairs.userLow, high: relationshipPairs.userHigh })
      .from(relationshipPairs)
      .where(
        and(
          eq(relationshipPairs.state, 'friends'),
          or(
            and(eq(relationshipPairs.userLow, ownerId), restrict(relationshipPairs.userHigh)),
            and(eq(relationshipPairs.userHigh, ownerId), restrict(relationshipPairs.userLow)),
          ),
        ),
      );
    return rows.map((row) => (row.low === ownerId ? row.high : row.low));
  },
  async block(ex: Executor, id: bigint, ownerId: bigint, targetId: bigint) {
    return (
      (
        await ex
          .insert(userBlocks)
          .values({ id, ownerId, targetId })
          .onConflictDoNothing()
          .returning({ id: userBlocks.id })
      ).length > 0
    );
  },
  async unblock(ex: Executor, ownerId: bigint, targetId: bigint) {
    return (
      (
        await ex
          .delete(userBlocks)
          .where(and(eq(userBlocks.ownerId, ownerId), eq(userBlocks.targetId, targetId)))
          .returning({ id: userBlocks.id })
      ).length > 0
    );
  },
  async metadata(ex: Executor, ownerId: bigint, targetId: bigint): Promise<RelationshipMetadata> {
    const [row] = await ex
      .select({ nickname: relationshipMetadata.nickname, note: relationshipMetadata.note })
      .from(relationshipMetadata)
      .where(
        and(eq(relationshipMetadata.ownerId, ownerId), eq(relationshipMetadata.targetId, targetId)),
      )
      .limit(1);
    return row ?? { nickname: null, note: null };
  },
  async setMetadata(
    ex: Executor,
    ownerId: bigint,
    targetId: bigint,
    metadata: RelationshipMetadata,
  ) {
    await ex
      .insert(relationshipMetadata)
      .values({ ownerId, targetId, ...metadata })
      .onConflictDoUpdate({
        target: [relationshipMetadata.ownerId, relationshipMetadata.targetId],
        set: { ...metadata, updatedAt: sql`now()` },
      });
  },
  async setPrivacy(ex: Executor, userId: bigint, patch: SocialPrivacyPatch) {
    const [row] = await ex
      .update(socialPrivacy)
      .set({ ...patch, version: sql`${socialPrivacy.version} + 1` })
      .where(eq(socialPrivacy.userId, userId))
      .returning();
    if (!row) throw new Error('privacy row missing');
    return row;
  },
  async list(ex: Executor, ownerId: bigint, query: RelationshipListQuery) {
    if (query.kind === 'blocked') {
      return ex
        .select({
          id: userBlocks.id,
          targetId: userBlocks.targetId,
          version: sql<number>`1`.mapWith(Number),
          kind: sql<RelationshipKind>`'blocked'`,
          nickname: relationshipMetadata.nickname,
          note: relationshipMetadata.note,
        })
        .from(userBlocks)
        .leftJoin(
          relationshipMetadata,
          and(
            eq(relationshipMetadata.ownerId, ownerId),
            eq(relationshipMetadata.targetId, userBlocks.targetId),
          ),
        )
        .where(
          and(
            eq(userBlocks.ownerId, ownerId),
            query.before ? lt(userBlocks.id, BigInt(query.before)) : undefined,
            query.after ? gt(userBlocks.id, BigInt(query.after)) : undefined,
          ),
        )
        .orderBy(query.after ? asc(userBlocks.id) : desc(userBlocks.id))
        .limit(query.limit + 1);
    }
    const targetId =
      sql<bigint>`case when ${relationshipPairs.userLow} = ${ownerId} then ${relationshipPairs.userHigh} else ${relationshipPairs.userLow} end`.mapWith(
        BigInt,
      );
    const state =
      query.kind === 'friends'
        ? eq(relationshipPairs.state, 'friends')
        : and(
            eq(relationshipPairs.state, 'pending'),
            query.kind === 'outgoing'
              ? eq(relationshipPairs.requestedBy, ownerId)
              : sql`${relationshipPairs.requestedBy} <> ${ownerId}`,
          );
    return ex
      .select({
        id: relationshipPairs.id,
        targetId,
        version: relationshipPairs.version,
        kind: sql<RelationshipKind>`case when ${relationshipPairs.state} = 'friends' then 'friends' when ${relationshipPairs.requestedBy} = ${ownerId} then 'outgoing' else 'incoming' end`,
        nickname: relationshipMetadata.nickname,
        note: relationshipMetadata.note,
      })
      .from(relationshipPairs)
      .leftJoin(
        relationshipMetadata,
        and(eq(relationshipMetadata.ownerId, ownerId), eq(relationshipMetadata.targetId, targetId)),
      )
      .where(
        and(
          or(eq(relationshipPairs.userLow, ownerId), eq(relationshipPairs.userHigh, ownerId)),
          state,
          query.before ? lt(relationshipPairs.id, BigInt(query.before)) : undefined,
          query.after ? gt(relationshipPairs.id, BigInt(query.after)) : undefined,
        ),
      )
      .orderBy(query.after ? asc(relationshipPairs.id) : desc(relationshipPairs.id))
      .limit(query.limit + 1);
  },
};
