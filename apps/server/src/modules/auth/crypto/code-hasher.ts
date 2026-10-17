import { createHmac, hkdfSync } from 'node:crypto';

/**
 * Keyed hash for low-entropy secrets (recovery codes). Unlike plain SHA-256, a database dump
 * alone doesn't allow offline brute force: the pepper lives only in the server's environment.
 */
export function createCodeHasher(keyBase64: string): (code: string) => Buffer {
  const pepper = Buffer.from(
    hkdfSync(
      'sha256',
      Buffer.from(keyBase64, 'base64'),
      Buffer.alloc(0),
      'silvercord/recovery-codes',
      32,
    ),
  );
  return (code) => createHmac('sha256', pepper).update(code).digest();
}
