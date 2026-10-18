/**
 * `media-decoder` container entry (ADR-0009): no network, no secrets, only the jobs volume.
 * Picks up `<jobs>/<id>/ready` one at a time and runs a sandboxed decode child for each.
 */
import { readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { runDecodeChild } from './run-decoder.ts';

const jobsDirectory = process.argv[2] ?? '/jobs';
const POLL_MS = 250;

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

let stopping = false;
process.on('SIGTERM', () => {
  stopping = true;
});

while (!stopping) {
  const entries = await readdir(jobsDirectory).catch(() => []);
  let worked = false;
  for (const entry of entries.sort()) {
    const job = join(jobsDirectory, entry);
    if (!(await exists(join(job, 'ready'))) || (await exists(join(job, 'claimed')))) continue;
    // `wx` makes the claim exclusive even if two supervisors share a volume.
    const claimed = await writeFile(join(job, 'claimed'), '', { flag: 'wx' }).then(
      () => true,
      () => false,
    );
    if (!claimed) continue;
    await runDecodeChild(job);
    worked = true;
  }
  if (!worked) await sleep(POLL_MS);
}
