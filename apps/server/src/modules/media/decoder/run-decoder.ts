import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { uploadFailureSchema } from '@silvercord/protocol';
import { z } from 'zod';
import type { DecodeResult } from './decode.ts';

export const DECODE_TIMEOUT_MS = 30_000;

const here = dirname(fileURLToPath(import.meta.url));
const childScript = join(here, 'decode-child.ts');
/** Code the child must be able to read: the server package and the real node_modules tree. */
const appRoot = resolve(here, '../../../..');
const sharpEntry = realpathSync(createRequire(import.meta.url).resolve('sharp'));
const modulesRoot = sharpEntry.slice(0, sharpEntry.indexOf(`${sep}node_modules${sep}`) + 13);

const variantSchema = z.strictObject({
  variant: z.enum(['display', 'thumbnail', 'download']),
  file: z.enum([
    'display.webp',
    'thumbnail.webp',
    'download.jpg',
    'download.png',
    'download.gif',
    'download.webp',
    'source',
  ]),
  mime: z.enum(['image/webp', 'image/jpeg', 'image/png', 'image/gif', 'video/mp4', 'video/webm']),
  width: z.number().int().positive().max(8192).nullable(),
  height: z.number().int().positive().max(8192).nullable(),
});

/** The child's output is untrusted too: only this exact shape is accepted. */
export const decodeResultSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    kind: z.enum(['image', 'video']),
    animated: z.boolean(),
    width: z.number().int().positive().max(8192),
    height: z.number().int().positive().max(8192),
    durationMs: z.number().int().nonnegative().nullable(),
    blurhash: z.string().max(64).nullable(),
    variants: z.array(variantSchema).min(1).max(3),
  }),
  z.strictObject({ ok: z.literal(true), kind: z.literal('file') }),
  z.strictObject({ ok: z.literal(false), failure: uploadFailureSchema }),
]);

const failed: DecodeResult = { ok: false, failure: 'PROCESSING_FAILED' };

export async function readDecodeResult(jobDir: string): Promise<DecodeResult> {
  try {
    const raw = await readFile(join(jobDir, 'result.json'), 'utf8');
    const parsed = decodeResultSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : failed;
  } catch {
    return failed;
  }
}

/**
 * Runs one decode child with an empty environment, a job-scoped fs permission model and a hard
 * wall-clock kill enforced from outside the decoding process.
 */
export function runDecodeChild(
  jobDir: string,
  timeoutMs = DECODE_TIMEOUT_MS,
): Promise<DecodeResult> {
  const job = resolve(jobDir);
  return new Promise((resolvePromise) => {
    const child = spawn(
      process.execPath,
      [
        '--permission',
        `--allow-fs-read=${appRoot}`,
        `--allow-fs-read=${modulesRoot}`,
        `--allow-fs-read=${job}`,
        `--allow-fs-write=${job}`,
        '--allow-addons',
        // ffprobe/ffmpeg for video posters and APNG; they inherit the empty environment.
        '--allow-child-process',
        childScript,
        job,
      ],
      { env: {}, stdio: 'ignore', windowsHide: true },
    );
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        void writeFile(join(job, 'result.json'), JSON.stringify(failed), { flag: 'wx' })
          .catch(() => undefined)
          .then(() => resolvePromise(failed));
        return;
      }
      void readDecodeResult(job).then(resolvePromise);
    });
    child.once('error', () => {
      clearTimeout(timer);
      resolvePromise(failed);
    });
  });
}
