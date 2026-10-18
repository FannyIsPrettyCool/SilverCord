import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import type { MediaVariant, UploadFailure } from '@silvercord/protocol';
import type { Database } from '../../db/client.ts';
import { channels as buses, type EventPublisher } from '../../gateway/event-bus.ts';
import type { DecodeResult } from './decoder/decode.ts';
import { DECODE_TIMEOUT_MS, readDecodeResult, runDecodeChild } from './decoder/run-decoder.ts';
import { mediaRepository as repo } from './media-repository.ts';
import type { UploadRow } from './media-schema.ts';
import type { StorageDriver } from './storage.ts';

export interface ProcessorDependencies {
  readonly db: Database;
  readonly storage: StorageDriver;
  readonly jobsDir: string;
  readonly decoder: 'local' | 'container';
  readonly events: EventPublisher;
  readonly log: { warn(object: object, message: string): void };
}

interface Output {
  readonly variant: MediaVariant;
  readonly path: string;
  readonly mime: string;
  readonly width: number | null;
  readonly height: number | null;
}

const CONTAINER_WAIT_MS = DECODE_TIMEOUT_MS + 15_000;
const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

async function hashFile(path: string): Promise<{ sha256: string; bytes: number }> {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    const buffer = chunk as Buffer;
    bytes += buffer.length;
    hash.update(buffer);
  }
  return { sha256: hash.digest('hex'), bytes };
}

/**
 * Worker-side orchestration (ADR-0009): assembles committed chunks, runs the isolated decoder,
 * stores immutable variants, then flips the row to ready. The DB row decides every step, so a
 * retried or duplicated job can never revive a deleted or attached upload.
 */
export function createMediaProcessor(deps: ProcessorDependencies) {
  const { db, storage, events, log } = deps;

  async function decodeIn(jobDir: string): Promise<DecodeResult> {
    if (deps.decoder === 'local') return runDecodeChild(jobDir);
    await writeFile(join(jobDir, 'ready'), '', { flag: 'wx' });
    const deadline = Date.now() + CONTAINER_WAIT_MS;
    while (Date.now() < deadline) {
      if (await exists(join(jobDir, 'result.json'))) return readDecodeResult(jobDir);
      await sleep(200);
    }
    return { ok: false, failure: 'PROCESSING_FAILED' };
  }

  async function notify(row: UploadRow) {
    await events
      .dispatch(buses.user(row.ownerId), 'MEDIA_CHANGED', { uploadId: row.id.toString() })
      .catch((error: unknown) => log.warn({ err: error }, 'media notification failed'));
  }

  async function dropChunks(uploadId: bigint) {
    for (const chunk of await repo.chunks(db, uploadId)) await storage.delete(chunk.storageKey);
    await repo.deleteChunks(db, uploadId);
  }

  async function fail(row: UploadRow, failure: UploadFailure) {
    const updated = await db.transaction(async (tx) => {
      const locked = await repo.find(tx, row.id, 'update');
      if (locked?.state !== 'processing') return null;
      await repo.adjustQuota(tx, locked.ownerId, { reserved: -locked.reservedBytes, stored: 0 });
      return repo.update(tx, row.id, { state: 'failed', failure, reservedBytes: 0 });
    });
    if (!updated) return;
    await dropChunks(row.id);
    await notify(updated);
  }

  function outputsOf(result: Extract<DecodeResult, { ok: true }>, jobDir: string): Output[] {
    const input = join(jobDir, 'input');
    if (result.kind === 'file') {
      return [
        {
          variant: 'download',
          path: input,
          mime: 'application/octet-stream',
          width: null,
          height: null,
        },
      ];
    }
    return result.variants.map((variant) => ({
      variant: variant.variant,
      path: variant.file === 'source' ? input : join(jobDir, 'out', variant.file),
      mime: variant.mime,
      width: variant.width,
      height: variant.height,
    }));
  }

  async function process(uploadId: bigint): Promise<void> {
    const row = await repo.find(db, uploadId);
    if (row?.state !== 'processing') return;
    const jobDir = join(deps.jobsDir, `${uploadId}-${randomBytes(6).toString('hex')}`);
    const storedKeys: string[] = [];
    try {
      await mkdir(jobDir, { recursive: true });
      const input = join(jobDir, 'input');
      for (const chunk of await repo.chunks(db, uploadId))
        await pipeline(storage.read(chunk.storageKey), createWriteStream(input, { flags: 'a' }));
      if ((await stat(input)).size !== row.sizeBytes) return await fail(row, 'MALFORMED');

      const result = await decodeIn(jobDir);
      if (!result.ok) return await fail(row, result.failure);

      const outputs = outputsOf(result, jobDir);
      const variants: Parameters<typeof repo.insertVariants>[1] = [];
      let total = 0;
      for (const output of outputs) {
        const { sha256, bytes } = await hashFile(output.path);
        total += bytes;
        // Result files are hostile too: the reservation bounds what processing may store.
        if (total > row.reservedBytes) {
          for (const key of storedKeys) await storage.delete(key);
          return await fail(row, 'LIMIT_EXCEEDED');
        }
        const storageKey = `objects/${uploadId}/${output.variant}-${sha256}`;
        await storage.put(storageKey, createReadStream(output.path));
        storedKeys.push(storageKey);
        variants.push({
          uploadId,
          variant: output.variant,
          storageKey,
          sha256,
          sizeBytes: bytes,
          mime: output.mime,
          width: output.width,
          height: output.height,
        });
      }

      const download = outputs.find((output) => output.variant === 'download');
      const updated = await db.transaction(async (tx) => {
        const locked = await repo.find(tx, uploadId, 'update');
        if (locked?.state !== 'processing') return null;
        await repo.insertVariants(tx, variants);
        await repo.adjustQuota(tx, locked.ownerId, {
          reserved: -locked.reservedBytes,
          stored: total,
        });
        return repo.update(tx, uploadId, {
          state: 'ready',
          kind: result.kind,
          detectedMime: download?.mime ?? 'application/octet-stream',
          width: result.kind === 'file' ? null : result.width,
          height: result.kind === 'file' ? null : result.height,
          durationMs: result.kind === 'file' ? null : result.durationMs,
          blurhash: result.kind === 'file' ? null : result.blurhash,
          animated: result.kind === 'file' ? false : result.animated,
          storedBytes: total,
          reservedBytes: 0,
        });
      });
      if (!updated) {
        // Deleted or expired while processing: nothing may survive it.
        for (const key of storedKeys) await storage.delete(key);
        return;
      }
      await dropChunks(uploadId);
      await notify(updated);
    } finally {
      await rm(jobDir, { recursive: true, force: true });
    }
  }

  return { process };
}
export type MediaProcessor = ReturnType<typeof createMediaProcessor>;
