/**
 * One decode job in a fresh process: `node decode-child.ts <jobDir>`. Reads `<jobDir>/input`,
 * writes variants to `<jobDir>/out/` and the outcome to `<jobDir>/result.json`. Runs with an
 * empty environment and a filesystem permission scope limited to the job (ADR-0009).
 */
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SNIFF_BYTES, sniff } from '../sniff.ts';
import { ATTACHMENT_SPEC, type DecodeSpec, decode, decodeSpecSchema } from './decode.ts';

/** Optional `<jobDir>/spec.json`; absent means a phase 2 attachment job. Malformed fails. */
async function readSpec(path: string): Promise<DecodeSpec> {
  const raw = await readFile(path, 'utf8').catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  });
  return raw === null ? ATTACHMENT_SPEC : decodeSpecSchema.parse(JSON.parse(raw.slice(0, 4096)));
}

const jobDir = process.argv[2];
if (!jobDir) process.exit(2);

const input = join(jobDir, 'input');
const out = join(jobDir, 'out');
await mkdir(out, { recursive: true });
const handle = await open(input, 'r');
const head = Buffer.alloc(SNIFF_BYTES);
const { bytesRead } = await handle.read(head, 0, SNIFF_BYTES, 0);
await handle.close();
const spec = await readSpec(join(jobDir, 'spec.json'));
const result = await decode(input, sniff(head.subarray(0, bytesRead)), out, spec);
await writeFile(join(jobDir, 'result.json'), JSON.stringify(result), { flag: 'wx' });
