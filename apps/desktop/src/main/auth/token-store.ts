import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, safeStorage } from 'electron';

const FILE_NAME = 'session.bin';

/**
 * Refresh token persistence through the OS keychain via `safeStorage` (BRIEF §6.1). Linux
 * without a secret service falls back to an obfuscation-only backend; in that case nothing is
 * written and the session ends when the app quits (docs/PLATFORM-LIMITS.md).
 */
export interface TokenStore {
  readonly persistent: boolean;
  load(): Promise<string | null>;
  save(refreshToken: string): Promise<void>;
  clear(): Promise<void>;
}

function hasSecureBackend(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false;
  if (process.platform !== 'linux') return true;
  return safeStorage.getSelectedStorageBackend() !== 'basic_text';
}

export function createTokenStore(): TokenStore {
  const path = join(app.getPath('userData'), FILE_NAME);
  const persistent = hasSecureBackend();
  let memory: string | null = null;

  return {
    persistent,
    async load() {
      if (!persistent) return memory;
      try {
        return safeStorage.decryptString(await readFile(path));
      } catch {
        return null;
      }
    },
    async save(refreshToken) {
      memory = refreshToken;
      if (persistent)
        await writeFile(path, safeStorage.encryptString(refreshToken), { mode: 0o600 });
    },
    async clear() {
      memory = null;
      await rm(path, { force: true });
    },
  };
}
