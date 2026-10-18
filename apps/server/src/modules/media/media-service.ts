import { createHash, randomBytes } from 'node:crypto';
import { type Readable, Transform } from 'node:stream';
import { Permission } from '@silvercord/permissions';
import {
  type Attachment,
  type CreateProfileUploadRequest,
  type CreateUploadRequest,
  type Crop,
  type MediaVariant,
  type ProfileImage,
  type ProfileMediaPurpose,
  type ProfileUpload,
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
import type { mediaUploads, UploadRow, VariantRow } from './media-schema.ts';

type NewUpload = typeof mediaUploads.$inferInsert;

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

/**
 * Who may start and see one profile-class purpose (ADR-0011). Profiles, guild expressions and
 * badges register theirs; an unregistered purpose cannot be uploaded or fetched.
 */
export interface ProfileMediaPolicy {
  /** Throws an AppError when `ownerId` may not upload for this guild (or account/instance). */
  authorizeUpload(ex: Executor, ownerId: bigint, guildId: bigint | null): Promise<void>;
  /** Whether `viewerId` may fetch this referenced upload right now. */
  canView(ex: Executor, viewerId: bigint, row: UploadRow): Promise<boolean>;
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

/** A processed profile-class image; null until display and thumbnail both exist. */
export function toProfileImage(
  row: UploadRow,
  variants: readonly VariantRow[],
): ProfileImage | null {
  const path = (variant: MediaVariant) => {
    const found = variants.find((candidate) => candidate.variant === variant);
    return found ? variantPath(row.id, variant, found.sha256) : null;
  };
  const display = path('display');
  const thumbnail = path('thumbnail');
  const shown = variants.find((candidate) => candidate.variant === 'display');
  if (!display || !thumbnail || !shown?.width || !shown.height) return null;
  return {
    uploadId: row.id.toString(),
    display,
    thumbnail,
    still: row.animated ? path('still') : null,
    animated: row.animated,
    width: shown.width,
    height: shown.height,
    dominantColor: row.dominantColor,
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

  const policies = new Map<ProfileMediaPurpose, ProfileMediaPolicy>();

  function policyFor(purpose: string): ProfileMediaPolicy {
    const policy = policies.get(purpose as ProfileMediaPurpose);
    if (!policy) throw notFound();
    return policy;
  }

  async function profileUploadView(ex: Executor, row: UploadRow): Promise<ProfileUpload> {
    const ready = row.state === 'ready' || row.state === 'attached';
    const variants = ready ? ((await variantsByUpload(ex, [row.id])).get(row.id) ?? []) : [];
    return {
      id: row.id.toString(),
      purpose: row.purpose as ProfileMediaPurpose,
      guildId: row.guildId?.toString() ?? null,
      filename: row.filename,
      sizeBytes: row.sizeBytes,
      offset: row.receivedBytes,
      chunkBytes: UPLOAD_CHUNK_MAX_BYTES,
      state: row.state,
      failure: (row.failure as ProfileUpload['failure']) ?? null,
      expiresAt: row.expiresAt.toISOString(),
      image: ready ? toProfileImage(row, variants) : null,
    };
  }

  async function uploadView(ex: Executor, row: UploadRow): Promise<Upload | ProfileUpload> {
    if (row.channelId === null) return profileUploadView(ex, row);
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
    if (row?.state !== 'attached' || messageId === undefined || row.channelId === null)
      throw notFound();
    await channels.requireChatMember(db, row.channelId, viewerId);
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

  /** Owner and scope checks shared by every chunk/complete step of an upload. */
  async function authorizeScope(ex: Executor, row: UploadRow, ownerId: bigint, lock: boolean) {
    if (row.channelId !== null) {
      if (lock) {
        await channels.lockForSend(ex as Transaction, row.channelId, ownerId);
        await channels.requireChatMember(
          ex,
          row.channelId,
          ownerId,
          undefined,
          Permission.SEND_MESSAGES | Permission.ATTACH_FILES,
        );
      } else await channels.requireChatMember(ex, row.channelId, ownerId);
      return;
    }
    await policyFor(row.purpose).authorizeUpload(ex, ownerId, row.guildId);
  }

  async function reserve(
    tx: Transaction,
    ownerId: bigint,
    sizeBytes: number,
    scope: Pick<NewUpload, 'channelId' | 'guildId' | 'purpose'>,
    filename: string,
  ): Promise<UploadRow> {
    if ((await repo.countInProgress(tx, ownerId)) >= limits.concurrentUploads)
      throw new AppError('CONFLICT', 'Too many uploads in progress');
    const reserved = sizeBytes * RESERVE_FACTOR;
    const ok = await repo.adjustQuota(
      tx,
      ownerId,
      { reserved, stored: 0 },
      { userBytes: limits.userQuotaBytes, instanceBytes: limits.instanceQuotaBytes },
    );
    if (!ok) throw new AppError('PAYLOAD_TOO_LARGE', 'Storage quota exceeded');
    return repo.insert(tx, {
      id: deps.nextId(),
      ownerId,
      ...scope,
      filename,
      sizeBytes,
      reservedBytes: reserved,
      expiresAt: new Date(Date.now() + limits.uploadTtlSeconds * 1000),
    });
  }

  /**
   * Profile-class references (ADR-0011): the owning module claims a ready upload when it starts
   * using it and releases it when it is replaced or removed, inside its own transaction.
   */
  const profileMedia = {
    async claim(
      tx: Transaction,
      input: {
        readonly ownerId: bigint;
        readonly uploadId: bigint;
        readonly purpose: ProfileMediaPurpose;
        readonly guildId: bigint | null;
        readonly field: string;
      },
    ): Promise<UploadRow> {
      const row = await repo.find(tx, input.uploadId, 'update');
      if (
        !row ||
        row.ownerId !== input.ownerId ||
        row.purpose !== input.purpose ||
        row.guildId !== input.guildId
      )
        throw new AppError('NOT_FOUND', 'Upload not found', { field: input.field });
      if (row.state !== 'ready' || row.expiresAt.getTime() <= Date.now())
        throw new AppError('CONFLICT', 'Upload is not ready', { field: input.field });
      return repo.update(tx, row.id, { state: 'attached' });
    },
    /** Tombstones uploads no longer referenced; call `purge` after commit (the sweep retries). */
    async release(tx: Transaction, uploadIds: readonly (bigint | null)[]): Promise<bigint[]> {
      const ids = uploadIds.filter((id): id is bigint => id !== null);
      for (const row of await repo.lockMany(tx, ids))
        if (row.state !== 'deleting') await repo.update(tx, row.id, { state: 'deleting' });
      return ids;
    },
    async images(ex: Executor, uploadIds: readonly (bigint | null)[]) {
      const ids = [...new Set(uploadIds.filter((id): id is bigint => id !== null))];
      const map = new Map<bigint, ProfileImage>();
      if (ids.length === 0) return map;
      const rows = await repo.findMany(ex, ids);
      const variants = await variantsByUpload(ex, ids);
      for (const row of rows) {
        if (row.state !== 'attached') continue;
        const image = toProfileImage(row, variants.get(row.id) ?? []);
        if (image) map.set(row.id, image);
      }
      return map;
    },
  };

  return {
    media,
    profileMedia,
    purge,
    uploadView,

    definePurpose(purpose: ProfileMediaPurpose, policy: ProfileMediaPolicy) {
      policies.set(purpose, policy);
    },

    async createProfile(
      ownerId: bigint,
      request: CreateProfileUploadRequest,
    ): Promise<ProfileUpload> {
      if (request.sizeBytes > limits.maxFileBytes)
        throw new AppError('PAYLOAD_TOO_LARGE', 'File too large', { field: 'sizeBytes' });
      const policy = policyFor(request.purpose);
      const guildId = request.guildId === undefined ? null : BigInt(request.guildId);
      const row = await db.transaction(async (tx: Transaction) => {
        await policy.authorizeUpload(tx, ownerId, guildId);
        return reserve(
          tx,
          ownerId,
          request.sizeBytes,
          { purpose: request.purpose, channelId: null, guildId },
          request.filename,
        );
      });
      return profileUploadView(db, row);
    },

    async create(
      ownerId: bigint,
      channelId: bigint,
      request: CreateUploadRequest,
    ): Promise<Upload> {
      if (request.sizeBytes > limits.maxFileBytes)
        throw new AppError('PAYLOAD_TOO_LARGE', 'File too large', { field: 'sizeBytes' });
      const row = await db.transaction(async (tx: Transaction) => {
        await channels.lockForSend(tx, channelId, ownerId);
        await channels.requireChatMember(
          tx,
          channelId,
          ownerId,
          undefined,
          Permission.SEND_MESSAGES | Permission.ATTACH_FILES,
        );
        return reserve(
          tx,
          ownerId,
          request.sizeBytes,
          { purpose: 'attachment', channelId, guildId: null },
          request.filename,
        );
      });
      return uploadView(db, row) as Promise<Upload>;
    },

    async get(ownerId: bigint, uploadId: bigint): Promise<Upload | ProfileUpload> {
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
      await authorizeScope(db, row, ownerId, false);
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

      const outcome = await db
        .transaction(async (tx) => {
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
        })
        .catch(async (error: unknown) => {
          // This object never entered the committed ledger, so neither purge nor sweep owns it.
          await storage.delete(key);
          throw error;
        });
      if (!outcome.keep) await storage.delete(key);
      return { offset: outcome.offset };
    },

    async complete(
      ownerId: bigint,
      uploadId: bigint,
      crop?: Crop,
    ): Promise<Upload | ProfileUpload> {
      const { row, queued } = await db.transaction(async (tx) => {
        const snapshot = await owned(tx, ownerId, uploadId);
        if (crop && snapshot.channelId !== null)
          throw new AppError('VALIDATION_FAILED', 'Attachments cannot be cropped', {
            field: 'crop',
          });
        await authorizeScope(tx, snapshot, ownerId, true);
        const locked = await owned(tx, ownerId, uploadId, 'update');
        if (locked.state !== 'uploading') return { row: locked, queued: false };
        if (locked.receivedBytes !== locked.sizeBytes)
          throw new AppError('CONFLICT', `Upload incomplete at offset ${locked.receivedBytes}`);
        const next = await repo.update(tx, uploadId, {
          state: 'processing',
          ...(crop ? { crop } : {}),
        });
        return { row: next, queued: true };
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
      const found = await repo.find(db, uploadId);
      if (!found) throw notFound();
      let row: UploadRow;
      if (found.channelId !== null) row = await accessibleUpload(viewerId, uploadId);
      else {
        // Owners preview their own processed uploads before they are put to use.
        const preview = found.state === 'ready' && found.ownerId === viewerId;
        const live =
          found.state === 'attached' &&
          (await policyFor(found.purpose).canView(db, viewerId, found));
        if (!preview && !live) throw notFound();
        row = found;
      }
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
