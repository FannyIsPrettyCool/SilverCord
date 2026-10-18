import { constants } from 'node:fs';
import { type FileHandle, lstat, open, realpath } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

/** Shared decoder files are hostile, including directory entries and special files. */
export class UnsafeJobFile extends Error {}
export class JobFileLimit extends Error {}

const component = (name: string) => {
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name === '.' || name === '..')
    throw new UnsafeJobFile('Invalid job component');
  return name;
};

/**
 * Linux pins every directory and resolves children relative to its fd. Neither renames nor
 * symlink swaps in the shared mount can redirect an already-open directory outside the job.
 * The non-Linux branch supports the trusted local development decoder only.
 */
export class JobDirectory {
  readonly path: string;
  private readonly handle: FileHandle | undefined;

  private constructor(path: string, handle?: FileHandle) {
    this.path = path;
    this.handle = handle;
  }

  static async open(path: string): Promise<JobDirectory> {
    if (process.platform === 'linux') {
      const handle = await open(
        path,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
      return new JobDirectory(path, handle);
    }
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink() || (await realpath(path)) !== resolve(path))
      throw new UnsafeJobFile('Unsafe job directory');
    return new JobDirectory(path);
  }

  childPath(name: string): string {
    return join(this.handle ? `/proc/self/fd/${this.handle.fd}` : this.path, component(name));
  }

  async directory(name: string): Promise<JobDirectory> {
    return JobDirectory.open(this.childPath(name));
  }

  async file(name: string, maxBytes: number): Promise<{ handle: FileHandle; size: number }> {
    const path = this.childPath(name);
    if (!this.handle) {
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink()) throw new UnsafeJobFile('Unsafe job file');
    }
    // NONBLOCK lets fstat reject a FIFO instead of hanging while opening it.
    const handle = await open(
      path,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
    );
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.nlink !== 1) throw new UnsafeJobFile('Unsafe job file');
      if (info.size > maxBytes) throw new JobFileLimit('Decoder output exceeds budget');
      return { handle, size: info.size };
    } catch (error) {
      await handle.close();
      throw error;
    }
  }

  async read(name: string, maxBytes: number): Promise<Buffer> {
    const { handle } = await this.file(name, maxBytes);
    try {
      const bytes = Buffer.alloc(maxBytes + 1);
      let length = 0;
      while (length < bytes.length) {
        const read = await handle.read(bytes, length, bytes.length - length, length);
        if (read.bytesRead === 0) break;
        length += read.bytesRead;
      }
      if (length > maxBytes) throw new JobFileLimit('Decoder output exceeds budget');
      return bytes.subarray(0, length);
    } finally {
      await handle.close();
    }
  }

  async close(): Promise<void> {
    await this.handle?.close();
  }
}

/** Anchor the immediate job parent, then refuse a symlink at the job entry itself. */
export async function openJobDirectory(path: string): Promise<JobDirectory> {
  const parent = await JobDirectory.open(dirname(path));
  try {
    return await parent.directory(basename(path));
  } finally {
    await parent.close();
  }
}
