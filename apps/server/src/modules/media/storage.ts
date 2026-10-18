import { randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/** Object storage behind an S3-like surface (ADR-0009); keys are opaque, never filenames. */
export interface StorageDriver {
  /** Streams `source` to `key`; the object appears atomically only after a full write. */
  put(key: string, source: Readable): Promise<void>;
  read(key: string): Readable;
  size(key: string): Promise<number | null>;
  delete(key: string): Promise<void>;
  /** Absolute filesystem path for processors that need a file (local driver only). */
  localPath(key: string): string;
}

const KEY_PATTERN = /^[a-z]+(\/[A-Za-z0-9._-]+)+$/;

export class StorageKeyError extends Error {
  readonly code = 'STORAGE_KEY_INVALID';
}

/** Filesystem driver: refuses any key that would resolve outside its root. */
export function createLocalStorage(rootDirectory: string): StorageDriver {
  const root = resolve(rootDirectory);

  function pathOf(key: string): string {
    if (!KEY_PATTERN.test(key) || key.includes('..')) throw new StorageKeyError(key);
    const path = resolve(root, key);
    if (!path.startsWith(root + sep)) throw new StorageKeyError(key);
    return path;
  }

  return {
    async put(key, source) {
      const path = pathOf(key);
      await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.${randomBytes(6).toString('hex')}.part`;
      try {
        await pipeline(source, createWriteStream(temporary, { flags: 'wx' }));
        await rename(temporary, path);
      } catch (error) {
        await rm(temporary, { force: true });
        throw error;
      }
    },
    read(key) {
      return createReadStream(pathOf(key));
    },
    async size(key) {
      try {
        const info = await stat(pathOf(key));
        return info.isFile() ? info.size : null;
      } catch {
        return null;
      }
    },
    async delete(key) {
      await rm(pathOf(key), { force: true });
    },
    localPath: pathOf,
  };
}
