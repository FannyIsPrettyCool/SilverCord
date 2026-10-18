import { appendFile, mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '../../db/client.ts';
import type { EventPublisher } from '../../gateway/event-bus.ts';
import { runDecodeChild } from './decoder/run-decoder.ts';
import { createMediaProcessor } from './media-processor.ts';
import { mediaRepository as repo } from './media-repository.ts';
import type { UploadRow } from './media-schema.ts';
import type { StorageDriver } from './storage.ts';

vi.mock('./decoder/run-decoder.ts', async (original) => ({
  ...(await original<typeof import('./decoder/run-decoder.ts')>()),
  runDecodeChild: vi.fn(),
}));

const directories: string[] = [];
const imageResult = {
  ok: true,
  kind: 'image',
  width: 1,
  height: 1,
  animated: false,
  durationMs: null,
  blurhash: null,
  variants: [
    { variant: 'download', file: 'download.jpg', mime: 'image/jpeg', width: 1, height: 1 },
  ],
} as const;

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'media-bridge-'));
  directories.push(root);
  const jobsDir = join(root, 'jobs');
  await mkdir(jobsDir);
  let row = {
    id: 1n,
    ownerId: 2n,
    channelId: 3n,
    state: 'processing',
    sizeBytes: 8,
    reservedBytes: 24,
  } as UploadRow;
  const objects = new Map<string, Buffer>([['staging/1/source', Buffer.from('original')]]);
  const storage: StorageDriver = {
    async put(key, body) {
      const chunks: Buffer[] = [];
      for await (const chunk of body) chunks.push(Buffer.from(chunk));
      objects.set(key, Buffer.concat(chunks));
    },
    read(key) {
      return Readable.from(objects.get(key) ?? Buffer.alloc(0));
    },
    async delete(key) {
      objects.delete(key);
    },
    async size(key) {
      return objects.get(key)?.length ?? null;
    },
    localPath: () => '',
  };
  const chunk = {
    uploadId: 1n,
    offset: 0,
    length: 8,
    sha256: Buffer.alloc(32),
    storageKey: 'staging/1/source',
  };
  vi.spyOn(repo, 'find').mockImplementation(async () => row);
  vi.spyOn(repo, 'chunks').mockResolvedValue([chunk]);
  vi.spyOn(repo, 'deleteChunks').mockResolvedValue();
  vi.spyOn(repo, 'adjustQuota').mockResolvedValue(true);
  vi.spyOn(repo, 'insertVariants').mockResolvedValue();
  vi.spyOn(repo, 'update').mockImplementation(async (_tx, _id, values) => {
    row = { ...row, ...values } as UploadRow;
    return row;
  });
  const db = { transaction: vi.fn(async (callback) => callback({})) } as unknown as Database;
  const processor = createMediaProcessor({
    db,
    storage,
    jobsDir,
    decoder: 'local',
    events: { dispatch: vi.fn().mockResolvedValue(undefined) } as unknown as EventPublisher,
    log: { warn: vi.fn() },
  });
  return { root, jobsDir, storage, objects, processor, row: () => row };
}

beforeEach(() => {
  vi.mocked(runDecodeChild).mockReset();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('decoder output boundary', () => {
  it.runIf(process.platform === 'linux')(
    'rejects file and intermediate directory symlinks to worker-only files',
    async () => {
      for (const target of ['output', 'out', 'source', 'job']) {
        const t = await setup();
        const secret = join(t.root, 'secret');
        await writeFile(secret, 'worker-secret');
        vi.mocked(runDecodeChild).mockImplementation(async (job) => {
          if (target === 'source') {
            await rm(join(job, 'input'));
            await symlink(secret, join(job, 'input'));
            return { ok: true, kind: 'file' };
          }
          const directory =
            target === 'out' || target === 'job' ? join(t.root, 'outside') : join(job, 'out');
          await mkdir(directory);
          if (target === 'out') await symlink(directory, join(job, 'out'));
          if (target === 'job') {
            await rename(job, `${job}-original`);
            await symlink(t.root, job);
            await mkdir(join(t.root, 'out'));
            await writeFile(join(t.root, 'out', 'download.jpg'), 'worker-secret');
          } else if (target === 'output') await symlink(secret, join(directory, 'download.jpg'));
          else await writeFile(join(directory, 'download.jpg'), 'worker-secret');
          return imageResult;
        });
        await t.processor.process(1n);
        expect(t.row().state, target).toBe('failed');
        expect(
          [...t.objects.keys()].filter((key) => key.startsWith('objects/')),
          target,
        ).toEqual([]);
        vi.restoreAllMocks();
      }
    },
  );

  it('rejects over-budget files and releases the reservation', async () => {
    const t = await setup();
    vi.mocked(runDecodeChild).mockImplementation(async (job) => {
      await mkdir(join(job, 'out'));
      await writeFile(join(job, 'out', 'download.jpg'), Buffer.alloc(25));
      return imageResult;
    });
    await t.processor.process(1n);
    expect(t.row().state).toBe('failed');
    expect(repo.adjustQuota).toHaveBeenCalledWith(expect.anything(), 2n, {
      reserved: -24,
      stored: 0,
    });
  });

  it('cleans already-stored variants when a later output is missing', async () => {
    const t = await setup();
    vi.mocked(runDecodeChild).mockImplementation(async (job) => {
      await mkdir(join(job, 'out'));
      await writeFile(join(job, 'out', 'download.jpg'), 'safe');
      return {
        ...imageResult,
        variants: [
          ...imageResult.variants,
          { variant: 'thumbnail', file: 'thumbnail.webp', mime: 'image/webp', width: 1, height: 1 },
        ],
      };
    });
    await t.processor.process(1n);
    expect(t.row().state).toBe('failed');
    expect([...t.objects.keys()].filter((key) => key.startsWith('objects/'))).toEqual([]);
  });

  it('stores and hashes bytes from the same opened file when its name is swapped', async () => {
    const t = await setup();
    let output = '';
    vi.mocked(runDecodeChild).mockImplementation(async (job) => {
      await mkdir(join(job, 'out'));
      output = join(job, 'out', 'download.jpg');
      await writeFile(output, 'safe');
      return imageResult;
    });
    const put = t.storage.put;
    vi.spyOn(t.storage, 'put').mockImplementation(async (key, body) => {
      await rename(output, `${output}-original`);
      await writeFile(output, 'tampered');
      return put(key, body);
    });
    await t.processor.process(1n);
    expect(t.row().state).toBe('ready');
    const stored = [...t.objects].find(([key]) => key.startsWith('objects/'));
    expect(stored?.[1].toString()).toBe('safe');
  });

  it('never deletes objects committed by a concurrent winning processor', async () => {
    const t = await setup();
    let count = 0;
    let release: () => void = () => {};
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(runDecodeChild).mockImplementation(async (job) => {
      await mkdir(join(job, 'out'));
      await writeFile(join(job, 'out', 'download.jpg'), 'safe');
      count += 1;
      if (count === 2) release();
      await barrier;
      return imageResult;
    });
    await Promise.all([t.processor.process(1n), t.processor.process(1n)]);
    const stored = [...t.objects].filter(([key]) => key.startsWith('objects/'));
    expect(stored).toHaveLength(1);
    expect(stored[0]?.[1].toString()).toBe('safe');
    expect(repo.insertVariants).toHaveBeenCalledOnce();
  });

  it('stops a regular file that grows after opening before it exceeds the reservation', async () => {
    const t = await setup();
    let output = '';
    vi.mocked(runDecodeChild).mockImplementation(async (job) => {
      await mkdir(join(job, 'out'));
      output = join(job, 'out', 'download.jpg');
      await writeFile(output, 'safe');
      return imageResult;
    });
    const put = t.storage.put;
    vi.spyOn(t.storage, 'put').mockImplementation(async (key, body) => {
      await appendFile(output, Buffer.alloc(25));
      return put(key, body);
    });
    await t.processor.process(1n);
    expect(t.row().state).toBe('failed');
    expect([...t.objects.keys()].filter((key) => key.startsWith('objects/'))).toEqual([]);
  });

  it('cleans output objects on storage failures while retaining the reservation for retry', async () => {
    const t = await setup();
    vi.mocked(runDecodeChild).mockImplementation(async (job) => {
      await mkdir(join(job, 'out'));
      await writeFile(join(job, 'out', 'download.jpg'), 'safe');
      return imageResult;
    });
    vi.spyOn(t.storage, 'put').mockImplementation(async (key) => {
      t.objects.set(key, Buffer.from('partial'));
      throw new Error('storage unavailable');
    });
    await expect(t.processor.process(1n)).rejects.toThrow('storage unavailable');
    expect(t.row().state).toBe('processing');
    expect(repo.adjustQuota).not.toHaveBeenCalled();
    expect([...t.objects.keys()].filter((key) => key.startsWith('objects/'))).toEqual([]);
  });
});
