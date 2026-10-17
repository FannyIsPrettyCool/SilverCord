import { randomBytes } from 'node:crypto';
import { BRAND } from '@silvercord/protocol';
import { Secret, TOTP } from 'otpauth';
import type { Valkey } from '../../infra/valkey.ts';

const PERIOD_SECONDS = 30;
const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

function totpFor(secret: Secret, label: string): TOTP {
  return new TOTP({
    issuer: BRAND.name,
    label,
    algorithm: 'SHA1',
    digits: 6,
    period: PERIOD_SECONDS,
    secret,
  });
}

export function generateTotpSecret(label: string): { secretBase32: string; otpauthUri: string } {
  const secret = new Secret({ size: 20 });
  return { secretBase32: secret.base32, otpauthUri: totpFor(secret, label).toString() };
}

/**
 * RFC 6238 check with ±1 step. A code is accepted once per user and step, so a shoulder-surfed
 * code cannot be replayed inside its window.
 */
export async function verifyTotp(
  valkey: Valkey,
  userId: bigint,
  secretBase32: string,
  code: string,
  now: number = Date.now(),
): Promise<boolean> {
  const totp = totpFor(Secret.fromBase32(secretBase32), userId.toString());
  const delta = totp.validate({ token: code, window: 1, timestamp: now });
  if (delta === null) return false;
  const step = Math.floor(now / 1000 / PERIOD_SECONDS) + delta;
  // SET NX on the (user, step) pair: only the first use of this code succeeds.
  const reply = await valkey.set(
    `totp-used:${userId}:${step}`,
    '1',
    'EX',
    PERIOD_SECONDS * 3,
    'NX',
  );
  return reply === 'OK';
}

/** Ten single-use codes shown once, formatted `xxxxx-xxxxx`. */
export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const bytes = randomBytes(10);
    const chars = Array.from(bytes, (byte) => RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length]);
    return `${chars.slice(0, 5).join('')}-${chars.slice(5).join('')}`;
  });
}
