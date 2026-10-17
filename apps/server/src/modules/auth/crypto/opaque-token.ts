import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export interface OpaqueToken {
  /** Sent to the client exactly once. */
  readonly token: string;
  /** SHA-256 of the token; the only form stored server-side. */
  readonly hash: Buffer;
}

/** 256-bit random bearer secret with a readable prefix (`scr_`, `sce_`…) for leak scanners. */
export function createOpaqueToken(prefix: string): OpaqueToken {
  const token = `${prefix}${randomBytes(32).toString('base64url')}`;
  return { token, hash: hashOpaqueToken(token) };
}

export function hashOpaqueToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

export function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}
