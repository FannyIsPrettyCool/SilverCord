import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '../../db/client.ts';
import type { ChannelsService } from '../channels/channels-service.ts';
import type { RelationshipsService } from '../relationships/relationships-service.ts';
import { mediaRepository as repo } from './media-repository.ts';
import type { UploadRow } from './media-schema.ts';
import { createMediaService } from './media-service.ts';
import type { StorageDriver } from './storage.ts';

afterEach(() => vi.restoreAllMocks());

describe('chunk transaction cleanup', () => {
  it.each(['conflicting retry', 'database rollback'])(
    'removes the new object after %s',
    async (mode) => {
      const bytes = Buffer.from('new bytes');
      const row = {
        id: 1n,
        ownerId: 2n,
        channelId: 3n,
        state: 'uploading',
        sizeBytes: 100,
        receivedBytes: mode === 'conflicting retry' ? bytes.length : 0,
        expiresAt: new Date(Date.now() + 60_000),
      } as UploadRow;
      const committed = {
        uploadId: 1n,
        offset: 0,
        length: bytes.length,
        sha256: createHash('sha256').update('old bytes').digest(),
        storageKey: 'staging/1/old',
      };
      const objects = new Map<string, Buffer>();
      const storage = {
        async put(key, body) {
          const chunks: Buffer[] = [];
          for await (const chunk of body) chunks.push(Buffer.from(chunk));
          objects.set(key, Buffer.concat(chunks));
        },
        async delete(key) {
          objects.delete(key);
        },
      } as StorageDriver;
      vi.spyOn(repo, 'find').mockResolvedValue(row);
      vi.spyOn(repo, 'chunkAt').mockResolvedValue(
        mode === 'conflicting retry' ? committed : undefined,
      );
      const db = {
        transaction:
          mode === 'database rollback'
            ? vi.fn().mockRejectedValue(new Error('database unavailable'))
            : vi.fn(async (callback) => callback({})),
      } as unknown as Database;
      const service = createMediaService({
        db,
        storage,
        channels: { requireMember: vi.fn().mockResolvedValue({}) } as unknown as ChannelsService,
        relationships: {} as RelationshipsService,
        nextId: () => 4n,
        limits: {
          maxFileBytes: 1000,
          userQuotaBytes: 3000,
          instanceQuotaBytes: 10000,
          concurrentUploads: 3,
          uploadTtlSeconds: 60,
        },
        enqueue: vi.fn(),
      });
      await expect(
        service.appendChunk(2n, 1n, 0, bytes.length, Readable.from(bytes)),
      ).rejects.toThrow();
      expect(objects.size).toBe(0);
    },
  );
});
