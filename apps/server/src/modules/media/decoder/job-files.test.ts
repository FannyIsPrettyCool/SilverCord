import { execFileSync } from 'node:child_process';
import { link, mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { JobDirectory, JobFileLimit, openJobDirectory } from './job-files.ts';
import { readDecodeResult } from './run-decoder.ts';

const directories: string[] = [];
async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'job-files-'));
  directories.push(root);
  const job = join(root, 'job');
  await mkdir(job);
  return { root, job };
}
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('shared decoder files', () => {
  it('bounds result.json and output files before reading their content', async () => {
    const { job } = await workspace();
    await writeFile(join(job, 'result.json'), ' '.repeat(16 * 1024 + 1));
    expect(await readDecodeResult(job)).toEqual({ ok: false, failure: 'PROCESSING_FAILED' });
    const directory = await openJobDirectory(job);
    try {
      await expect(directory.file('result.json', 10)).rejects.toBeInstanceOf(JobFileLimit);
    } finally {
      await directory.close();
    }
  });

  it.runIf(process.platform === 'linux')(
    'rejects symlinks, hardlinks, FIFOs and directory replacements',
    async () => {
      const { root, job } = await workspace();
      const secret = join(root, 'secret');
      await writeFile(secret, '{"ok":true,"kind":"file"}');
      await symlink(secret, join(job, 'result.json'));
      expect(await readDecodeResult(job)).toEqual({ ok: false, failure: 'PROCESSING_FAILED' });
      await rm(join(job, 'result.json'));
      await link(secret, join(job, 'result.json'));
      expect(await readDecodeResult(job)).toEqual({ ok: false, failure: 'PROCESSING_FAILED' });
      await rm(join(job, 'result.json'));
      execFileSync('mkfifo', [join(job, 'result.json')]);
      expect(await readDecodeResult(job)).toEqual({ ok: false, failure: 'PROCESSING_FAILED' });
      await rm(join(job, 'result.json'));

      const directory = await openJobDirectory(job);
      try {
        await rename(job, `${job}-old`);
        await symlink(root, job);
        await expect(directory.file('secret', 100)).rejects.toThrow();
        await expect(openJobDirectory(job)).rejects.toThrow();
      } finally {
        await directory.close();
      }
    },
  );

  it('reads valid result files through the pinned job directory', async () => {
    const { job } = await workspace();
    await writeFile(join(job, 'result.json'), '{"ok":true,"kind":"file"}');
    const directory = await JobDirectory.open(job);
    try {
      expect((await directory.read('result.json', 100)).toString()).toBe(
        '{"ok":true,"kind":"file"}',
      );
    } finally {
      await directory.close();
    }
  });
});
