/**
 * One decode job in a fresh process: `node decode-child.ts <jobDir>`. Reads `<jobDir>/input`,
 * writes variants to `<jobDir>/out/` and the outcome to `<jobDir>/result.json`. Runs with an
 * empty environment and a filesystem permission scope limited to the job (ADR-0009).
 */
import { mkdir, open, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SNIFF_BYTES, sniff } from '../sniff.ts';
import { decode } from './decode.ts';

const jobDir = process.argv[2];
if (!jobDir) process.exit(2);

const input = join(jobDir, 'input');
const out = join(jobDir, 'out');
await mkdir(out, { recursive: true });
const handle = await open(input, 'r');
const head = Buffer.alloc(SNIFF_BYTES);
const { bytesRead } = await handle.read(head, 0, SNIFF_BYTES, 0);
await handle.close();
const result = await decode(input, sniff(head.subarray(0, bytesRead)), out);
await writeFile(join(jobDir, 'result.json'), JSON.stringify(result), { flag: 'wx' });
