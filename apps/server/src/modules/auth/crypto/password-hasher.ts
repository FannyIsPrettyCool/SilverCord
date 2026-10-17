import { hash, verify } from '@node-rs/argon2';

/** OWASP Password Storage Cheat Sheet minimum for Argon2id (BRIEF §8.1). */
const PARAMS = {
  // `Algorithm.Argon2id`; the package exports it as an ambient const enum, unusable under
  // verbatimModuleSyntax.
  algorithm: 2,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

const PARAM_SIGNATURE = `m=${PARAMS.memoryCost},t=${PARAMS.timeCost},p=${PARAMS.parallelism}`;

export interface PasswordCheck {
  readonly valid: boolean;
  /** The stored hash uses older parameters; store a fresh hash after a successful login. */
  readonly needsRehash: boolean;
}

export function hashPassword(password: string): Promise<string> {
  return hash(password, PARAMS);
}

export async function verifyPassword(storedHash: string, password: string): Promise<PasswordCheck> {
  const valid = await verify(storedHash, password);
  return { valid, needsRehash: valid && !storedHash.includes(PARAM_SIGNATURE) };
}

let dummyHash: Promise<string> | undefined;

/**
 * Spends the same work as a real verification so unknown accounts can't be detected by timing
 * (threat model T2).
 */
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword('not-a-real-password-placeholder');
  await verify(await dummyHash, password);
}
