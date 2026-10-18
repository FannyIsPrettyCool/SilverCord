import { and, asc, desc, eq, gt, inArray, lt, sql } from 'drizzle-orm';
import type { Executor } from '../../db/executor.ts';
import { type ChannelRow, channelMembers, channels, dmPairs } from './channels-schema.ts';

const ordered = (a: bigint, b: bigint) => (a < b ? { low: a, high: b } : { low: b, high: a });

export const channelsRepository = {
  async find(ex: Executor, channelId: bigint, lock?: 'update' | 'share') {
    const query = ex.select().from(channels).where(eq(channels.id, channelId)).limit(1);
    const [row] = await (lock ? query.for(lock) : query);
    return row;
  },
  async isMember(ex: Executor, channelId: bigint, userId: bigint): Promise<boolean> {
    const [row] = await ex
      .select({ userId: channelMembers.userId })
      .from(channelMembers)
      .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, userId)))
      .limit(1);
    return row !== undefined;
  },
  async memberIds(ex: Executor, channelId: bigint): Promise<bigint[]> {
    const rows = await ex
      .select({ userId: channelMembers.userId })
      .from(channelMembers)
      .where(eq(channelMembers.channelId, channelId))
      .orderBy(asc(channelMembers.userId));
    return rows.map((row) => row.userId);
  },
  async membersOf(ex: Executor, channelIds: readonly bigint[]) {
    if (channelIds.length === 0) return [];
    return ex
      .select({ channelId: channelMembers.channelId, userId: channelMembers.userId })
      .from(channelMembers)
      .where(inArray(channelMembers.channelId, [...channelIds]))
      .orderBy(asc(channelMembers.joinedAt), asc(channelMembers.userId));
  },
  async dmChannel(ex: Executor, a: bigint, b: bigint): Promise<bigint | undefined> {
    const { low, high } = ordered(a, b);
    const [row] = await ex
      .select({ channelId: dmPairs.channelId })
      .from(dmPairs)
      .where(and(eq(dmPairs.userLow, low), eq(dmPairs.userHigh, high)))
      .limit(1);
    return row?.channelId;
  },
  async dmPair(ex: Executor, channelId: bigint) {
    const [row] = await ex.select().from(dmPairs).where(eq(dmPairs.channelId, channelId)).limit(1);
    return row;
  },
  /** Inserts the DM unless the pair already exists; returns the winning channel id. */
  async createDm(ex: Executor, id: bigint, a: bigint, b: bigint): Promise<bigint> {
    const { low, high } = ordered(a, b);
    const existing = await this.dmChannel(ex, a, b);
    if (existing) return existing;
    await ex.insert(channels).values({ id, type: 'dm' });
    const inserted = await ex
      .insert(dmPairs)
      .values({ userLow: low, userHigh: high, channelId: id })
      .onConflictDoNothing()
      .returning({ channelId: dmPairs.channelId });
    if (inserted.length === 0) {
      // A concurrent open won; drop our orphan channel inside this transaction.
      await ex.delete(channels).where(eq(channels.id, id));
      const winner = await this.dmChannel(ex, a, b);
      if (!winner) throw new Error('dm pair vanished');
      return winner;
    }
    await ex.insert(channelMembers).values([
      { channelId: id, userId: low },
      { channelId: id, userId: high },
    ]);
    return id;
  },
  async createGroup(
    ex: Executor,
    input: { id: bigint; ownerId: bigint; name: string | null; memberIds: readonly bigint[] },
  ) {
    await ex
      .insert(channels)
      .values({ id: input.id, type: 'group_dm', ownerId: input.ownerId, name: input.name });
    await ex
      .insert(channelMembers)
      .values(input.memberIds.map((userId) => ({ channelId: input.id, userId })));
  },
  async addMember(ex: Executor, channelId: bigint, userId: bigint): Promise<boolean> {
    const rows = await ex
      .insert(channelMembers)
      .values({ channelId, userId })
      .onConflictDoNothing()
      .returning({ userId: channelMembers.userId });
    return rows.length > 0;
  },
  async removeMember(ex: Executor, channelId: bigint, userId: bigint): Promise<boolean> {
    const rows = await ex
      .delete(channelMembers)
      .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, userId)))
      .returning({ userId: channelMembers.userId });
    return rows.length > 0;
  },
  async update(
    ex: Executor,
    channelId: bigint,
    values: Partial<Pick<ChannelRow, 'name' | 'ownerId'>>,
  ): Promise<ChannelRow> {
    const [row] = await ex
      .update(channels)
      .set({ ...values, version: sql`${channels.version} + 1`, updatedAt: sql`now()` })
      .where(eq(channels.id, channelId))
      .returning();
    if (!row) throw new Error('channel disappeared under lock');
    return row;
  },
  async setLastMessage(ex: Executor, channelId: bigint, messageId: bigint) {
    await ex
      .update(channels)
      .set({ lastMessageId: messageId, updatedAt: sql`now()` })
      .where(eq(channels.id, channelId));
  },
  async delete(ex: Executor, channelId: bigint) {
    await ex.delete(channels).where(eq(channels.id, channelId));
  },
  async listForUser(
    ex: Executor,
    userId: bigint,
    query: { before?: string | undefined; after?: string | undefined; limit: number },
  ) {
    return ex
      .select({
        id: channels.id,
        type: channels.type,
        ownerId: channels.ownerId,
        name: channels.name,
        version: channels.version,
        lastMessageId: channels.lastMessageId,
        createdAt: channels.createdAt,
        updatedAt: channels.updatedAt,
      })
      .from(channelMembers)
      .innerJoin(channels, eq(channels.id, channelMembers.channelId))
      .where(
        and(
          eq(channelMembers.userId, userId),
          inArray(channels.type, ['dm', 'group_dm']),
          query.before ? lt(channelMembers.channelId, BigInt(query.before)) : undefined,
          query.after ? gt(channelMembers.channelId, BigInt(query.after)) : undefined,
        ),
      )
      .orderBy(query.after ? asc(channelMembers.channelId) : desc(channelMembers.channelId))
      .limit(query.limit + 1);
  },
};
