import { createHash, randomBytes } from 'node:crypto';
import { type Readable, Transform } from 'node:stream';
import {
  type Attachment,
  type CreateUploadRequest,
  type MediaVariant,
  UPLOAD_CHUNK_MAX_BYTES,
  type Upload,
} from '@silvercord/protocol';
import type { Database } from '../../db/client.ts';
import type { Executor, Transaction } from '../../db/executor.ts';
import { AppError } from '../../http/app-error.ts';
import type { ChannelsService } from '../channels/channels-service.ts';
import type { MessageMedia } from '../messages/messages-service.ts';
import type { RelationshipsService } from '../relationships/relationships-service.ts';
import { mediaRepository as repo } from './media-repository.ts';
import type { UploadRow, VariantRow } from './media-schema.ts';
import type { StorageDriver } from './storage.ts';

export interface MediaLimits {
  readonly maxFileBytes: number;
  readonly userQuotaBytes: number;
  readonly instanceQuotaBytes: number;
  readonly concurrentUploads: number;
  readonly uploadTtlSeconds: number;
}

export interface MediaDependencies {
  readonly db: Database;
  readonly storage: StorageDriver;
  readonly channels: ChannelsService;
  readonly relationships: RelationshipsService;
  readonly nextId: () => bigint;
  readonly limits: MediaLimits;
  /** Queues processing for a completed upload (BullMQ job `media:<id>`). */
  readonly enqueue: (uploadId: bigint) => Promise<void>;
}

/** Source plus up to twice its size for derived files is reserved up front. */
export const RESERVE_FACTOR = 3;
const notFound = () => new AppError('NOT_FOUND', 'Upload not found');

export function variantPath(uploadId: bigint, variant: MediaVariant, sha256: string): string {
  return `/media/${uploadId}/${variant}/${sha256}`;
}

export function toAttachment(row: UploadRow, variants: readonly VariantRow[]): Attachment {
  return {
    id: row.id.toString(),
    filename: row.filename,
    contentType: row.detectedMime ?? 'application/octet-stream',
    sizeBytes: row.sizeBytes,
    kind: row.kind ?? 'file',
    width: row.width,
    height: row.height,
    durationMs: row.durationMs,
    blurhash: row.blurhash,
    animated: row.animated,
    variants: variants.map((variant) => ({
      variant: variant.variant,
      path: variantPath(row.id, variant.variant, variant.sha256),
      contentType: variant.mime,
      sizeBytes: variant.sizeBytes,
      width: variant.width,
      height: variant.height,
    })),
  };
}

/** Counts and hashes bytes in flight, failing as soon as more than `limit` arrive. */
function meter(limit: number) {
  const hash = createHash('sha256');
  let bytes = 0;
  const transform = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > limit) {
        callback(new AppError('PAYLOAD_TOO_LARGE', 'Chunk larger than declared'));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  return { transform, result: () => ({ bytes, sha256: hash.digest() }) };
}

/** docs/spec/media.md: reservation, resumable chunks, completion, attachment and delivery. */
export function createMediaService(deps: MediaDependencies) {
  const { db, storage, channels, relationships, limits } = deps;

  async function variantsByUpload(ex: Executor, uploadIds: readonly bigint[]) {
    const map = new Map<bigint, VariantRow[]>();
    for (const variant of await repo.variants(ex, uploadIds)) {
      const list = map.get(variant.uploadId) ?? [];
      list.push(variant);
      map.set(variant.uploadId, list);
    }
    return map;
  }

  async function uploadView(ex: Executor, row: UploadRow): Promise<Upload> {
    const ready = row.state === 'ready' || row.state === 'attached';
    const variants = ready ? ((await variantsByUpload(ex, [row.id])).get(row.id) ?? []) : [];
    return {
      id: row.id.toString(),
      channelId: row.channelId.toString(),
      filename: row.filename,
      sizeBytes: row.sizeBytes,
      offset: row.receivedBytes,
      chunkBytes: UPLOAD_CHUNK_MAX_BYTES,
      state: row.state,
      failure: (row.failure as Upload['failure']) ?? null,
      expiresAt: row.expiresAt.toISOString(),
      attachment: ready ? toAttachment(row, variants) : null,
    };
  }

  async function owned(ex: Executor, ownerId: bigint, uploadId: bigint, lock?: 'update') {
    const row = await repo.find(ex, uploadId, lock);
    if (!row || row.ownerId !== ownerId) throw notFound();
    return row;
  }

  /** Removes stored objects, releases quota and deletes the row; safe to repeat. */
  async function purge(uploadId: bigint) {
    const row = await repo.find(db, uploadId);
    if (!row) return;
    const keys = [
      ...(await repo.chunks(db, uploadId)).map((chunk) => chunk.storageKey),
      ...(await repo.variants(db, [uploadId])).map((variant) => variant.storageKey),
    ];
    for (const key of keys) await storage.delete(key);
    await db.transaction(async (tx) => {
      const locked = await repo.find(tx, uploadId, 'update');
      if (!locked) return;
      await repo.adjustQuota(tx, locked.ownerId, {
        reserved: -locked.reservedBytes,
        stored: -locked.storedBytes,
      });
      await repo.delete(tx, uploadId);
    });
  }

  async function accessibleUpload(viewerId: bigint, uploadId: bigint): Promise<UploadRow> {
    const row = await repo.find(db, uploadId);
    const messageId = row ? await repo.attachmentMessage(db, uploadId) : undefined;
    if (!row || row.state !== 'attached' || messageId === undefined) throw notFound();
    await channels.requireMember(db, row.channelId, viewerId);
    // The uploader is always the message author (attach requires ownership).
    if ((await relationships.blockedByViewer(db, viewerId)).has(row.ownerId)) throw notFound();
    return row;
  }

  const media: MessageMedia = {
    async attach(tx, input) {
      if (input.uploadIds.length === 0) return;
      const rows = await repo.lockMany(tx, input.uploadIds);
      const byId = new Map(rows.map((row) => [row.id, row]));
      const now = Date.now();
      for (const uploadId of input.uploadIds) {
        const row = byId.get(uploadId);
        if (!row || row.ownerId !== input.ownerId || row.channelId !== input.channelId)
          throw new AppError('NOT_FOUND', 'Upload not found', { field: 'attachmentIds' });
        if (row.state !== 'ready' || row.expiresAt.getTime() <= now)
          throw new AppError('CONFLICT', 'Upload is not ready', { field: 'attachmentIds' });
      }
      await repo.insertAttachments(
        tx,
        input.uploadIds.map((uploadId, position) => ({
          messageId: input.messageId,
          uploadId,
          position,
        })),
      );
      for (const uploadId of input.uploadIds)
        await repo.update(tx, uploadId, { state: 'attached' });
    },
    async views(ex, messageIds) {
      const rows = await repo.attachmentsOf(ex, messageIds);
      const variants = await variantsByUpload(
        ex,
        rows.map((row) => row.upload.id),
      );
      const map = new Map<bigint, Attachment[]>();
      for (const { messageId, upload } of rows) {
        if (upload.state !== 'attached') continue;
        const list = map.get(messageId) ?? [];
        list.push(toAttachment(upload, variants.get(upload.id) ?? []));
        map.set(messageId, list);
      }
      return map;
    },
    async release(tx, messageIds) {
      await repo.markDeletingForMessages(tx, messageIds);
    },
  };

  return {
    media,
    purge,
    uploadView,

    async create(
      ownerId: bigint,
      channelId: bigint,
      request: CreateUploadRequest,
    ): Promise<Upload> {
      if (request.sizeBytes > limits.maxFileBytes)
        throw new AppError('PAYLOAD_TOO_LARGE', 'File too large', { field: 'sizeBytes' });
      const row = await db.transaction(async (tx: Transaction) => {
        await channels.lockForSend(tx, channelId, ownerId);
        if ((await repo.countInProgress(tx, ownerId)) >= limits.concurrentUploads)
          throw new AppError('CONFLICT', 'Too many uploads in progress');
        const reserve = request.sizeBytes * RESERVE_FACTOR;
        const reserved = await repo.adjustQuota(
          tx,
          ownerId,
          { reserved: reserve, stored: 0 },
          { userBytes: limits.userQuotaBytes, instanceBytes: limits.instanceQuotaBytes },
        );
        if (!reserved) throw new AppError('PAYLOAD_TOO_LARGE', 'Storage quota exceeded');
        return repo.insert(tx, {
          id: deps.nextId(),
          ownerId,
          channelId,
          filename: request.filename,
          sizeBytes: request.sizeBytes,
          reservedBytes: reserve,
          expiresAt: new Date(Date.now() + limits.uploadTtlSeconds * 1000),
        });
      });
      return uploadView(db, row);
    },

    async get(ownerId: bigint, uploadId: bigint): Promise<Upload> {
      return uploadView(db, await owned(db, ownerId, uploadId));
    },

    /**
     * Appends one chunk at exactly the committed offset. A retry of an already committed chunk
     * with the same bytes returns the saved offset; different bytes conflict.
     */
    async appendChunk(
      ownerId: bigint,
      uploadId: bigint,
      offset: number,
      length: number,
      body: Readable,
    ): Promise<{ offset: number }> {
      const row = await owned(db, ownerId, uploadId);
      await channels.requireMember(db, row.channelId, ownerId);
      if (row.state !== 'uploading' || row.expiresAt.getTime() <= Date.now())
        throw new AppError('CONFLICT', 'Upload no longer accepts data');
      if (length > UPLOAD_CHUNK_MAX_BYTES || offset + length > row.sizeBytes)
        throw new AppError('PAYLOAD_TOO_LARGE', 'Chunk exceeds the declared size');
      const committed =
        offset < row.receivedBytes ? await repo.chunkAt(db, uploadId, offset) : undefined;
      if (offset > row.receivedBytes || (offset < row.receivedBytes && !committed))
        throw new AppError('CONFLICT', `Expected offset ${row.receivedBytes}`);

      const key = `staging/${uploadId}/${offset}-${randomBytes(8).toString('hex')}`;
      const metered = meter(length);
      try {
        await storage.put(key, body.pipe(metered.transform));
      } catch (error) {
        await storage.delete(key);
        throw error instanceof AppError
          ? error
          : new AppError('VALIDATION_FAILED', 'Upload interrupted');
      }
      const { bytes, sha256 } = metered.result();
      if (bytes !== length) {
        await storage.delete(key);
        throw new AppError('VALIDATION_FAILED', 'Body length does not match Content-Length');
      }

      const outcome = await db.transaction(async (tx) => {
        const locked = await owned(tx, ownerId, uploadId, 'update');
        const existing = await repo.chunkAt(tx, uploadId, offset);
        if (existing) {
          if (existing.length !== length || !existing.sha256.equals(sha256))
            throw new AppError('CONFLICT', 'A different chunk was already committed here');
          return { offset: locked.receivedBytes, keep: false };
        }
        if (locked.receivedBytes !== offset || locked.state !== 'uploading')
          throw new AppError('CONFLICT', `Expected offset ${locked.receivedBytes}`);
        await repo.insertChunk(tx, { uploadId, offset, length, sha256, storageKey: key });
        const updated = await repo.update(tx, uploadId, { receivedBytes: offset + length });
        return { offset: updated.receivedBytes, keep: true };
      });
      if (!outcome.keep) await storage.delete(key);
      return { offset: outcome.offset };
    },

    async complete(ownerId: bigint, uploadId: bigint): Promise<Upload> {
      const { row, queued } = await db.transaction(async (tx) => {
        const snapshot = await owned(tx, ownerId, uploadId);
        await channels.lockForSend(tx, snapshot.channelId, ownerId);
        const locked = await owned(tx, ownerId, uploadId, 'update');
        if (locked.state !== 'uploading') return { row: locked, queued: false };
        if (locked.receivedBytes !== locked.sizeBytes)
          throw new AppError('CONFLICT', `Upload incomplete at offset ${locked.receivedBytes}`);
        return { row: await repo.update(tx, uploadId, { state: 'processing' }), queued: true };
      });
      // DB state is authoritative: a lost enqueue is repaired by the worker's reconciler.
      if (queued) await deps.enqueue(uploadId).catch(() => undefined);
      return uploadView(db, row);
    },

    async remove(ownerId: bigint, uploadId: bigint) {
      await db.transaction(async (tx) => {
        const row = await owned(tx, ownerId, uploadId, 'update');
        if (row.state === 'attached') throw new AppError('CONFLICT', 'Upload is attached');
        if (row.state !== 'deleting') await repo.update(tx, uploadId, { state: 'deleting' });
      });
      await purge(uploadId);
    },

    /**
     * Authorizes one delivery: the viewer is a current member of the channel of a live message
     * carrying this upload, and has not blocked its author. Unknown and denied look the same.
     */
    async authorizeFetch(
      viewerId: bigint,
      uploadId: bigint,
      variant: MediaVariant,
      sha256: string,
    ) {
      const row = await accessibleUpload(viewerId, uploadId);
      const match = (await repo.variants(db, [uploadId])).find(
        (candidate) => candidate.variant === variant && candidate.sha256 === sha256,
      );
      if (!match) throw notFound();
      return { variant: match, filename: row.filename };
    },

    async attachmentFor(viewerId: bigint, uploadId: bigint): Promise<Attachment> {
      const row = await accessibleUpload(viewerId, uploadId);
      return toAttachment(row, await repo.variants(db, [uploadId]));
    },

    /**
     * The channel is being deleted and its upload rows cascade with it: release their quota in
     * this transaction and remove the stored objects after commit.
     */
    async channelDeleted(tx: Transaction, channelId: bigint): Promise<() => Promise<void>> {
      const uploads = await repo.lockForChannel(tx, channelId);
      const keys = await repo.storageKeys(
        tx,
        uploads.map((upload) => upload.id),
      );
      for (const upload of uploads)
        await repo.adjustQuota(tx, upload.ownerId, {
          reserved: -upload.reservedBytes,
          stored: -upload.storedBytes,
        });
      return async () => {
        for (const key of keys) await storage.delete(key);
      };
    },

    /** Deletes tombstoned and expired unattached uploads in bounded batches. */
    async sweep(batch = 100): Promise<number> {
      const candidates = await repo.cleanupCandidates(db, batch);
      for (const { id } of candidates) await purge(id);
      return candidates.length;
    },

    pendingProcessing: (limit = 100) => repo.processing(db, limit),
  };
}
export type MediaService = ReturnType<typeof createMediaService>;
