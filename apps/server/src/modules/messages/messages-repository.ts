import { REACTIONS_DISTINCT_MAX, UNREAD_COUNT_CAP } from '@silvercord/protocol';
import { and, asc, desc, eq, gt, inArray, lt, sql } from 'drizzle-orm';
import type { Executor } from '../../db/executor.ts';
import {
  type MessageRow,
  messageIdempotency,
  messageMentions,
  messageReactions,
  messages,
  readStates,
} from './messages-schema.ts';

export const REACTIONS_PER_USER_MAX = 20;

/** `author_id NOT IN (...)`, or no condition when nothing is excluded. */
function authorNotIn(excluded: readonly bigint[]) {
  if (excluded.length === 0) return sql`true`;
  return sql`(${messages.authorId} is null or ${messages.authorId} not in (${sql.join(
    excluded.map((id) => sql`${id}`),
    sql`, `,
  )}))`;
}

export const messagesRepository = {
  async find(ex: Executor, channelId: bigint, messageId: bigint, lock?: 'update') {
    const query = ex
      .select()
      .from(messages)
      .where(and(eq(messages.channelId, channelId), eq(messages.id, messageId)))
      .limit(1);
    const [row] = await (lock ? query.for(lock) : query);
    return row;
  },
  async findMany(ex: Executor, channelId: bigint, ids: readonly bigint[]) {
    if (ids.length === 0) return [];
    return ex
      .select()
      .from(messages)
      .where(and(eq(messages.channelId, channelId), inArray(messages.id, [...ids])));
  },
  async insert(ex: Executor, row: typeof messages.$inferInsert) {
    const [inserted] = await ex.insert(messages).values(row).returning();
    if (!inserted) throw new Error('insert returned no row');
    return inserted;
  },
  async page(
    ex: Executor,
    channelId: bigint,
    query: { before?: string | undefined; after?: string | undefined; limit: number },
  ): Promise<MessageRow[]> {
    return ex
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.channelId, channelId),
          query.before ? lt(messages.id, BigInt(query.before)) : undefined,
          query.after ? gt(messages.id, BigInt(query.after)) : undefined,
        ),
      )
      .orderBy(query.after ? asc(messages.id) : desc(messages.id))
      .limit(query.limit + 1);
  },
  async updateContent(ex: Executor, messageId: bigint, content: string) {
    const [row] = await ex
      .update(messages)
      .set({ content, editedAt: sql`now()`, version: sql`${messages.version} + 1` })
      .where(eq(messages.id, messageId))
      .returning();
    if (!row) throw new Error('message disappeared under lock');
    return row;
  },
  async delete(ex: Executor, messageId: bigint) {
    await ex.delete(messages).where(eq(messages.id, messageId));
  },

  async findIdempotency(ex: Executor, authorId: bigint, key: string) {
    const [row] = await ex
      .select()
      .from(messageIdempotency)
      .where(and(eq(messageIdempotency.authorId, authorId), eq(messageIdempotency.key, key)))
      .limit(1);
    return row;
  },
  async insertIdempotency(ex: Executor, row: typeof messageIdempotency.$inferInsert) {
    await ex.insert(messageIdempotency).values(row);
  },
  /** Proves a later DELETE of an already-deleted message comes from its author. */
  async authoredDeleted(ex: Executor, authorId: bigint, channelId: bigint, messageId: bigint) {
    const [row] = await ex
      .select({ key: messageIdempotency.key })
      .from(messageIdempotency)
      .where(
        and(
          eq(messageIdempotency.authorId, authorId),
          eq(messageIdempotency.channelId, channelId),
          eq(messageIdempotency.messageId, messageId),
        ),
      )
      .limit(1);
    return row !== undefined;
  },

  async setMentions(ex: Executor, messageId: bigint, userIds: readonly bigint[]) {
    await ex.delete(messageMentions).where(eq(messageMentions.messageId, messageId));
    if (userIds.length)
      await ex.insert(messageMentions).values(userIds.map((userId) => ({ messageId, userId })));
  },
  async mentionsOf(ex: Executor, messageIds: readonly bigint[]) {
    if (messageIds.length === 0) return [];
    return ex
      .select({ messageId: messageMentions.messageId, userId: messageMentions.userId })
      .from(messageMentions)
      .where(inArray(messageMentions.messageId, [...messageIds]));
  },

  /** Per-message emoji counts excluding `hiddenActors`, with whether the viewer reacted. */
  async reactionSummaries(
    ex: Executor,
    messageIds: readonly bigint[],
    viewerId: bigint,
    hiddenActors: readonly bigint[],
  ) {
    if (messageIds.length === 0) return [];
    const visibleActor =
      hiddenActors.length === 0
        ? undefined
        : sql`${messageReactions.userId} not in (${sql.join(
            hiddenActors.map((id) => sql`${id}`),
            sql`, `,
          )})`;
    return ex
      .select({
        messageId: messageReactions.messageId,
        emoji: messageReactions.emoji,
        count: sql<number>`count(*)::int`,
        me: sql<boolean>`bool_or(${messageReactions.userId} = ${viewerId})`,
        first: sql<Date>`min(${messageReactions.createdAt})`,
      })
      .from(messageReactions)
      .where(and(inArray(messageReactions.messageId, [...messageIds]), visibleActor))
      .groupBy(messageReactions.messageId, messageReactions.emoji)
      .orderBy(sql`min(${messageReactions.createdAt})`);
  },
  /** Adds a reaction within the per-message and per-user caps; false when already present. */
  async addReaction(ex: Executor, messageId: bigint, userId: bigint, emoji: string) {
    const [counts] = await ex
      .select({
        distinct: sql<number>`count(distinct ${messageReactions.emoji})::int`,
        mine: sql<number>`count(*) filter (where ${messageReactions.userId} = ${userId})::int`,
        exists: sql<boolean>`bool_or(${messageReactions.emoji} = ${emoji} and ${messageReactions.userId} = ${userId})`,
        emojiPresent: sql<boolean>`bool_or(${messageReactions.emoji} = ${emoji})`,
      })
      .from(messageReactions)
      .where(eq(messageReactions.messageId, messageId));
    if (counts?.exists) return false;
    if (!counts?.emojiPresent && (counts?.distinct ?? 0) >= REACTIONS_DISTINCT_MAX)
      return 'limit' as const;
    if ((counts?.mine ?? 0) >= REACTIONS_PER_USER_MAX) return 'limit' as const;
    const rows = await ex
      .insert(messageReactions)
      .values({ messageId, userId, emoji })
      .onConflictDoNothing()
      .returning({ emoji: messageReactions.emoji });
    return rows.length > 0;
  },
  async removeReaction(ex: Executor, messageId: bigint, userId: bigint, emoji: string) {
    const rows = await ex
      .delete(messageReactions)
      .where(
        and(
          eq(messageReactions.messageId, messageId),
          eq(messageReactions.userId, userId),
          eq(messageReactions.emoji, emoji),
        ),
      )
      .returning({ emoji: messageReactions.emoji });
    return rows.length > 0;
  },

  async readState(ex: Executor, userId: bigint, channelId: bigint) {
    const [row] = await ex
      .select({ lastReadMessageId: readStates.lastReadMessageId })
      .from(readStates)
      .where(and(eq(readStates.userId, userId), eq(readStates.channelId, channelId)))
      .limit(1);
    return row?.lastReadMessageId ?? null;
  },
  /** Monotonic: the stored high-water mark never moves backwards. Returns whether it moved. */
  async advanceReadState(ex: Executor, userId: bigint, channelId: bigint, messageId: bigint) {
    const rows = await ex
      .insert(readStates)
      .values({ userId, channelId, lastReadMessageId: messageId })
      .onConflictDoUpdate({
        target: [readStates.userId, readStates.channelId],
        set: { lastReadMessageId: messageId, updatedAt: sql`now()` },
        setWhere: sql`${readStates.lastReadMessageId} is null or ${readStates.lastReadMessageId} < ${messageId}`,
      })
      .returning({ lastReadMessageId: readStates.lastReadMessageId });
    return rows.length > 0;
  },
  /**
   * Own read position plus capped unread and mention counts per channel, in one statement.
   * Own messages and messages by `hiddenAuthors` never count.
   */
  async unreadCounts(
    ex: Executor,
    viewerId: bigint,
    channelIds: readonly bigint[],
    hiddenAuthors: readonly bigint[],
  ) {
    if (channelIds.length === 0) return [];
    const ids = sql.join(
      channelIds.map((id) => sql`(${id}::bigint)`),
      sql`, `,
    );
    const visible = authorNotIn(hiddenAuthors);
    const rows = await ex.execute<{
      channel_id: string;
      last_read: string | null;
      unread: number;
      mentions: number;
    }>(sql`
      select c.id::text as channel_id,
        rs.last_read_message_id::text as last_read,
        (select count(*)::int from (
          select 1 from ${messages}
          where ${messages.channelId} = c.id
            and ${messages.id} > coalesce(rs.last_read_message_id, 0)
            and ${messages.authorId} is distinct from ${viewerId}
            and ${visible}
          limit ${UNREAD_COUNT_CAP}) unread_rows) as unread,
        (select count(*)::int from (
          select 1 from ${messageMentions}
          join ${messages} on ${messages.id} = ${messageMentions.messageId}
          where ${messageMentions.userId} = ${viewerId}
            and ${messages.channelId} = c.id
            and ${messageMentions.messageId} > coalesce(rs.last_read_message_id, 0)
            and ${visible}
          limit ${UNREAD_COUNT_CAP}) mention_rows) as mentions
      from (values ${ids}) as c(id)
      left join ${readStates} rs on rs.user_id = ${viewerId} and rs.channel_id = c.id
    `);
    return rows.map((row) => ({
      channelId: BigInt(row.channel_id),
      lastReadMessageId: row.last_read,
      unreadCount: row.unread,
      mentionCount: row.mentions,
    }));
  },
};
