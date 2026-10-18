import { and, asc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import type { Executor } from '../../db/executor.ts';
import {
  mediaQuotaUsage,
  mediaUploadChunks,
  mediaUploads,
  mediaVariants,
  messageAttachments,
  type UploadRow,
} from './media-schema.ts';

export interface QuotaLimits {
  readonly userBytes: number;
  readonly instanceBytes: number;
}

const INSTANCE_SCOPE = 'instance';
const userScope = (userId: bigint) => `user:${userId}`;

export const mediaRepository = {
  async find(ex: Executor, uploadId: bigint, lock?: 'update') {
    const query = ex.select().from(mediaUploads).where(eq(mediaUploads.id, uploadId)).limit(1);
    const [row] = await (lock ? query.for(lock) : query);
    return row;
  },
  async insert(ex: Executor, row: typeof mediaUploads.$inferInsert): Promise<UploadRow> {
    const [inserted] = await ex.insert(mediaUploads).values(row).returning();
    if (!inserted) throw new Error('insert returned no row');
    return inserted;
  },
  async update(ex: Executor, uploadId: bigint, values: Partial<typeof mediaUploads.$inferInsert>) {
    const [row] = await ex
      .update(mediaUploads)
      .set({ ...values, version: sql`${mediaUploads.version} + 1` })
      .where(eq(mediaUploads.id, uploadId))
      .returning();
    if (!row) throw new Error('upload disappeared under lock');
    return row;
  },
  async delete(ex: Executor, uploadId: bigint) {
    await ex.delete(mediaUploads).where(eq(mediaUploads.id, uploadId));
  },
  async countInProgress(ex: Executor, ownerId: bigint): Promise<number> {
    const [row] = await ex
      .select({ count: sql<number>`count(*)::int` })
      .from(mediaUploads)
      .where(
        and(
          eq(mediaUploads.ownerId, ownerId),
          eq(mediaUploads.state, 'uploading'),
          sql`${mediaUploads.expiresAt} > now()`,
        ),
      );
    return row?.count ?? 0;
  },

  async chunks(ex: Executor, uploadId: bigint) {
    return ex
      .select()
      .from(mediaUploadChunks)
      .where(eq(mediaUploadChunks.uploadId, uploadId))
      .orderBy(asc(mediaUploadChunks.offset));
  },
  async chunkAt(ex: Executor, uploadId: bigint, offset: number) {
    const [row] = await ex
      .select()
      .from(mediaUploadChunks)
      .where(and(eq(mediaUploadChunks.uploadId, uploadId), eq(mediaUploadChunks.offset, offset)))
      .limit(1);
    return row;
  },
  async insertChunk(ex: Executor, row: typeof mediaUploadChunks.$inferInsert) {
    await ex.insert(mediaUploadChunks).values(row);
  },
  async deleteChunks(ex: Executor, uploadId: bigint) {
    await ex.delete(mediaUploadChunks).where(eq(mediaUploadChunks.uploadId, uploadId));
  },

  async variants(ex: Executor, uploadIds: readonly bigint[]) {
    if (uploadIds.length === 0) return [];
    return ex
      .select()
      .from(mediaVariants)
      .where(inArray(mediaVariants.uploadId, [...uploadIds]));
  },
  async insertVariants(ex: Executor, rows: (typeof mediaVariants.$inferInsert)[]) {
    if (rows.length) await ex.insert(mediaVariants).values(rows);
  },

  /** Attachment rows with their uploads for the given messages, in display order. */
  async attachmentsOf(ex: Executor, messageIds: readonly bigint[]) {
    if (messageIds.length === 0) return [];
    return ex
      .select({ messageId: messageAttachments.messageId, upload: mediaUploads })
      .from(messageAttachments)
      .innerJoin(mediaUploads, eq(mediaUploads.id, messageAttachments.uploadId))
      .where(inArray(messageAttachments.messageId, [...messageIds]))
      .orderBy(asc(messageAttachments.messageId), asc(messageAttachments.position));
  },
  async attachmentMessage(ex: Executor, uploadId: bigint) {
    const [row] = await ex
      .select({ messageId: messageAttachments.messageId })
      .from(messageAttachments)
      .where(eq(messageAttachments.uploadId, uploadId))
      .limit(1);
    return row?.messageId;
  },
  async insertAttachments(ex: Executor, rows: (typeof messageAttachments.$inferInsert)[]) {
    if (rows.length) await ex.insert(messageAttachments).values(rows);
  },
  async markDeletingForMessages(ex: Executor, messageIds: readonly bigint[]) {
    if (messageIds.length === 0) return;
    await ex
      .update(mediaUploads)
      .set({ state: 'deleting', version: sql`${mediaUploads.version} + 1` })
      .where(
        inArray(
          mediaUploads.id,
          ex
            .select({ id: messageAttachments.uploadId })
            .from(messageAttachments)
            .where(inArray(messageAttachments.messageId, [...messageIds])),
        ),
      );
  },
  async lockForChannel(ex: Executor, channelId: bigint) {
    return ex
      .select()
      .from(mediaUploads)
      .where(eq(mediaUploads.channelId, channelId))
      .orderBy(asc(mediaUploads.id))
      .for('update');
  },
  async storageKeys(ex: Executor, uploadIds: readonly bigint[]): Promise<string[]> {
    if (uploadIds.length === 0) return [];
    const list = [...uploadIds];
    const [chunks, variants] = await Promise.all([
      ex
        .select({ key: mediaUploadChunks.storageKey })
        .from(mediaUploadChunks)
        .where(inArray(mediaUploadChunks.uploadId, list)),
      ex
        .select({ key: mediaVariants.storageKey })
        .from(mediaVariants)
        .where(inArray(mediaVariants.uploadId, list)),
    ]);
    return [...chunks, ...variants].map((row) => row.key);
  },
  async lockMany(ex: Executor, uploadIds: readonly bigint[]) {
    if (uploadIds.length === 0) return [];
    return ex
      .select()
      .from(mediaUploads)
      .where(inArray(mediaUploads.id, [...uploadIds]))
      .orderBy(asc(mediaUploads.id))
      .for('update');
  },

  /** Rows the cleanup sweep owns: tombstoned, or expired before being attached. */
  async cleanupCandidates(ex: Executor, limit: number) {
    return ex
      .select({ id: mediaUploads.id })
      .from(mediaUploads)
      .where(
        or(
          eq(mediaUploads.state, 'deleting'),
          and(
            inArray(mediaUploads.state, ['uploading', 'processing', 'ready', 'failed']),
            lt(mediaUploads.expiresAt, sql`now()`),
          ),
        ),
      )
      .orderBy(asc(mediaUploads.id))
      .limit(limit);
  },
  async processing(ex: Executor, limit: number) {
    return ex
      .select({ id: mediaUploads.id })
      .from(mediaUploads)
      .where(eq(mediaUploads.state, 'processing'))
      .orderBy(asc(mediaUploads.id))
      .limit(limit);
  },

  /**
   * Applies a quota change, taking the instance row lock before the user's. Reservations are
   * checked against limits; releases and settlements never fail.
   */
  async adjustQuota(
    ex: Executor,
    userId: bigint,
    delta: { reserved: number; stored: number },
    limits?: QuotaLimits,
  ): Promise<boolean> {
    const scopes = [INSTANCE_SCOPE, userScope(userId)];
    await ex
      .insert(mediaQuotaUsage)
      .values(scopes.map((scope) => ({ scope })))
      .onConflictDoNothing();
    const rows = await ex
      .select()
      .from(mediaQuotaUsage)
      .where(inArray(mediaQuotaUsage.scope, scopes))
      .orderBy(sql`${mediaQuotaUsage.scope} <> ${INSTANCE_SCOPE}`, asc(mediaQuotaUsage.scope))
      .for('update');
    if (limits) {
      for (const row of rows) {
        const limit = row.scope === INSTANCE_SCOPE ? limits.instanceBytes : limits.userBytes;
        if (row.reservedBytes + row.storedBytes + delta.reserved + delta.stored > limit)
          return false;
      }
    }
    await ex
      .update(mediaQuotaUsage)
      .set({
        reservedBytes: sql`greatest(0, ${mediaQuotaUsage.reservedBytes} + ${delta.reserved})`,
        storedBytes: sql`greatest(0, ${mediaQuotaUsage.storedBytes} + ${delta.stored})`,
      })
      .where(inArray(mediaQuotaUsage.scope, scopes));
    return true;
  },
};
