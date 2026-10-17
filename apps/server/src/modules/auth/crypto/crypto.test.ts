import { describe, expect, it } from 'vitest';
import { AppError } from '../../../http/app-error.ts';
import { createTokenIssuer } from './access-tokens.ts';
import { createOpaqueToken, hashOpaqueToken, safeEqual } from './opaque-token.ts';
import { hashPassword, verifyPassword } from './password-hasher.ts';
import { createSecretBox } from './secret-box.ts';

const SECRET = 'test-secret-that-is-long-enough-0123456789';

async function codeOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error instanceof AppError ? error.code : 'other';
  }
  return 'none';
}

describe('password hasher', () => {
  it('hashes with argon2id and verifies', async () => {
    const stored = await hashPassword('correct horse battery');
    expect(stored).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await verifyPassword(stored, 'correct horse battery')).toEqual({
      valid: true,
      needsRehash: false,
    });
    expect((await verifyPassword(stored, 'wrong')).valid).toBe(false);
  });
});

describe('opaque tokens', () => {
  it('stores only a hash and compares safely', () => {
    const { token, hash } = createOpaqueToken('scr_');
    expect(token.startsWith('scr_')).toBe(true);
    expect(token.length).toBeGreaterThan(40);
    expect(safeEqual(hashOpaqueToken(token), hash)).toBe(true);
    expect(safeEqual(hashOpaqueToken(`${token}x`), hash)).toBe(false);
  });
});

describe('secret box', () => {
  const box = createSecretBox(Buffer.alloc(32, 3).toString('base64'));

  it('round-trips and detects tampering', () => {
    const sealed = box.seal(Buffer.from('JBSWY3DPEHPK3PXP'));
    expect(box.open(sealed).toString()).toBe('JBSWY3DPEHPK3PXP');
    const tampered = Buffer.from(sealed);
    tampered[tampered.length - 1] = (tampered.at(-1) ?? 0) ^ 1;
    expect(() => box.open(tampered)).toThrow();
  });
});

describe('token issuer', () => {
  it('round-trips access claims', async () => {
    const issuer = createTokenIssuer(SECRET);
    const { token, expiresAt } = await issuer.issueAccessToken({
      userId: 42n,
      sessionId: 9_000_000_000_000_000_001n,
    });
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(await issuer.verifyAccessToken(token)).toEqual({
      userId: 42n,
      sessionId: 9_000_000_000_000_000_001n,
    });
  });

  it('rejects expired, foreign and cross-type tokens', async () => {
    const past = createTokenIssuer(SECRET, () => new Date(Date.now() - 3_600_000));
    const issuer = createTokenIssuer(SECRET);
    const expired = (await past.issueAccessToken({ userId: 1n, sessionId: 2n })).token;
    expect(await codeOf(issuer.verifyAccessToken(expired))).toBe('TOKEN_EXPIRED');

    const foreign = (
      await createTokenIssuer(`${SECRET}-other`).issueAccessToken({ userId: 1n, sessionId: 2n })
    ).token;
    expect(await codeOf(issuer.verifyAccessToken(foreign))).toBe('TOKEN_INVALID');

    const ticket = await issuer.issueMfaTicket(1n, 'Desktop');
    expect(await codeOf(issuer.verifyAccessToken(ticket))).toBe('TOKEN_INVALID');
    expect(await issuer.verifyMfaTicket(ticket)).toEqual({ userId: 1n, deviceName: 'Desktop' });
    expect(await codeOf(issuer.verifyAccessToken('garbage'))).toBe('TOKEN_INVALID');
  });
});
