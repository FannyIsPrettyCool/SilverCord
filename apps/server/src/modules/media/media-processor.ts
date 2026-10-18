import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { type FileHandle, lstat, mkdir, open, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { platform } from 'node:process';
import { Readable } from 'node:stream';
import { setTimeout as sleep } from 'node:timers/promises';
import type { MediaVariant, UploadFailure } from '@silvercord/protocol';
import type { Database } from '../../db/client.ts';
import { channels as buses, type EventPublisher } from '../../gateway/event-bus.ts';
import type { DecodeResult } from './decoder/decode.ts';
import { JobDirectory, JobFileLimit, UnsafeJobFile } from './decoder/job-files.ts';
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
  readonly file: string;
  readonly mime: string;
  readonly width: number | null;
  readonly height: number | null;
}

const CONTAINER_WAIT_MS = DECODE_TIMEOUT_MS + 15_000;
const exists = (path: string) =>
  lstat(path).then(
    () => true,
    () => false,
  );

async function storeFile(
  storage: StorageDriver,
  key: string,
  handle: FileHandle,
  size: number,
  budget: number,
): Promise<{ sha256: string; bytes: number }> {
  const hash = createHash('sha256');
  let bytes = 0;
  const source = handle.createReadStream({ autoClose: false });
  const measured = Readable.from(
    (async function* () {
      for await (const chunk of source) {
        const buffer = chunk as Buffer;
        bytes += buffer.length;
        if (bytes > budget) throw new JobFileLimit('Decoder output exceeds budget');
        hash.update(buffer);
        yield buffer;
      }
    })(),
  );
  try {
    await storage.put(key, measured);
    if (bytes !== size) throw new UnsafeJobFile('Decoder file changed while being read');
    return { sha256: hash.digest('hex'), bytes };
  } finally {
    measured.destroy();
    source.destroy();
  }
}

/**
 * Worker-side orchestration (ADR-0009): assembles committed chunks, runs the isolated decoder,
 * stores immutable variants, then flips the row to ready. The DB row decides every step, so a
 * retried or duplicated job can never revive a deleted or attached upload.
 */
export function createMediaProcessor(deps: ProcessorDependencies) {
  const { db, storage, events, log } = deps;

  async function decodeIn(jobDir: string, job: JobDirectory): Promise<DecodeResult> {
    if (deps.decoder === 'local') return runDecodeChild(jobDir);
    if (platform !== 'linux')
      throw new UnsafeJobFile('Container decoding requires Linux fd isolation');
    await writeFile(job.childPath('ready'), '', { flag: 'wx' });
    const deadline = Date.now() + CONTAINER_WAIT_MS;
    while (Date.now() < deadline) {
      if (await exists(job.childPath('result.json'))) return readDecodeResult(jobDir, job);
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

  function outputsOf(result: Extract<DecodeResult, { ok: true }>): Output[] {
    if (result.kind === 'file') {
      return [
        {
          variant: 'download',
          file: 'source',
          mime: 'application/octet-stream',
          width: null,
          height: null,
        },
      ];
    }
    return result.variants.map((variant) => ({
      variant: variant.variant,
      file: variant.file,
      mime: variant.mime,
      width: variant.width,
      height: variant.height,
    }));
  }

  async function process(uploadId: bigint): Promise<void> {
    const row = await repo.find(db, uploadId);
    if (row?.state !== 'processing') return;
    const attempt = randomBytes(12).toString('hex');
    const jobName = `${uploadId}-${attempt}`;
    const jobDir = join(deps.jobsDir, jobName);
    const storedKeys: string[] = [];
    await mkdir(deps.jobsDir, { recursive: true });
    const root = await JobDirectory.open(deps.jobsDir);
    let job: JobDirectory | undefined;
    let committed = false;
    try {
      await mkdir(root.childPath(jobName));
      job = await root.directory(jobName);
      const input = await open(
        job.childPath('input'),
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
        0o600,
      );
      try {
        let position = 0;
        for (const chunk of await repo.chunks(db, uploadId)) {
          for await (const bytes of storage.read(chunk.storageKey)) {
            const buffer = bytes as Buffer;
            let offset = 0;
            while (offset < buffer.length) {
              const written = await input.write(buffer, offset, buffer.length - offset, position);
              offset += written.bytesWritten;
              position += written.bytesWritten;
            }
          }
        }
        if ((await input.stat()).size !== row.sizeBytes) return await fail(row, 'MALFORMED');
      } finally {
        await input.close();
      }

      const result = await decodeIn(jobDir, job);
      if (!result.ok) return await fail(row, result.failure);

      const outputs = outputsOf(result);
      const variants: Parameters<typeof repo.insertVariants>[1] = [];
      let total = 0;
      for (const output of outputs) {
        let out: JobDirectory | undefined;
        let file: FileHandle | undefined;
        // Attempt-specific keys mean a stale worker can only delete its own objects.
        const storageKey = `objects/${uploadId}/${attempt}-${output.variant}`;
        let sha256: string;
        let bytes: number;
        try {
          if (output.file !== 'source') out = await job.directory('out');
          const directory = out ?? job;
          const opened = await directory.file(
            output.file === 'source' ? 'input' : output.file,
            row.reservedBytes - total,
          );
          file = opened.handle;
          storedKeys.push(storageKey);
          ({ sha256, bytes } = await storeFile(
            storage,
            storageKey,
            file,
            opened.size,
            row.reservedBytes - total,
          ));
        } finally {
          await file?.close();
          await out?.close();
        }
        total += bytes;
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
        return;
      }
      committed = true;
      await dropChunks(uploadId);
      await notify(updated);
    } catch (error) {
      if (error instanceof JobFileLimit) await fail(row, 'LIMIT_EXCEEDED');
      else if (
        error instanceof UnsafeJobFile ||
        (error instanceof Error &&
          'code' in error &&
          ['ENOENT', 'ELOOP', 'ENOTDIR', 'EISDIR'].includes(String(error.code)))
      )
        await fail(row, 'PROCESSING_FAILED');
      else throw error;
    } finally {
      if (!committed) for (const key of storedKeys) await storage.delete(key);
      await job?.close();
      await rm(root.childPath(jobName), { recursive: true, force: true });
      await root.close();
    }
  }

  return { process };
}
export type MediaProcessor = ReturnType<typeof createMediaProcessor>;
