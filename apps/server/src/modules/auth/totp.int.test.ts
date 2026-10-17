import {
  authTokensSchema,
  mfaChallengeSchema,
  totpEnableResponseSchema,
  totpSetupResponseSchema,
} from '@silvercord/protocol';
import { Secret, TOTP } from 'otpauth';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, expectError, openRegistration, register } from '../../../test/auth-helpers.ts';
import { createTestApp, type TestApp } from '../../../test/test-app.ts';

function codeFor(secret: string, offsetSteps = 0) {
  const totp = new TOTP({
    secret: Secret.fromBase32(secret),
    digits: 6,
    period: 30,
    algorithm: 'SHA1',
  });
  return totp.generate({ timestamp: Date.now() + offsetSteps * 30_000 });
}

describe('TOTP', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
    await openRegistration(t);
  });
  afterAll(() => t.close());

  const post = (url: string, payload?: Record<string, unknown>, headers?: Record<string, string>) =>
    t.request({
      method: 'POST',
      url,
      ...(payload ? { payload } : {}),
      ...(headers ? { headers } : {}),
    });

  async function enrolled() {
    const { account, tokens } = await register(t);
    const setup = totpSetupResponseSchema.parse(
      (
        await post('/api/v1/auth/totp/setup', { password: account.password }, bearer(tokens))
      ).json(),
    );
    expect(setup.otpauthUri).toMatch(/^otpauth:\/\/totp\/SilverCord:/);
    expectError(
      await post('/api/v1/auth/totp/enable', { code: '000000' }, bearer(tokens)),
      401,
      'INVALID_TOTP',
    );
    const enable = await post(
      '/api/v1/auth/totp/enable',
      { code: codeFor(setup.secret, -1) },
      bearer(tokens),
    );
    expect(enable.statusCode).toBe(200);
    const { recoveryCodes } = totpEnableResponseSchema.parse(enable.json());
    expect(recoveryCodes).toHaveLength(10);
    return { account, tokens, secret: setup.secret, recoveryCodes };
  }

  async function challenge(account: { email: string; password: string }) {
    const response = await post('/api/v1/auth/login', {
      login: account.email,
      password: account.password,
      deviceName: 'Desk',
    });
    return mfaChallengeSchema.parse(response.json()).ticket;
  }

  it('requires the password to start setup and mails the owner when 2FA turns on', async () => {
    const { tokens } = await register(t);
    expectError(
      await post('/api/v1/auth/totp/setup', { password: 'wrong password!' }, bearer(tokens)),
      401,
      'INVALID_CREDENTIALS',
    );
    expectError(
      await post('/api/v1/auth/totp/setup', {}, bearer(tokens)),
      400,
      'VALIDATION_FAILED',
    );
    const { account } = await enrolled();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(
      t.mailer.sent.some((m) => m.to === account.email && m.subject.includes('turned on')),
    ).toBe(true);
  });

  it('requires a second factor once enabled and refuses replayed codes', async () => {
    const { account, secret } = await enrolled();
    const ticket = await challenge(account);
    expectError(
      await post('/api/v1/auth/login/totp', { ticket, code: '123456' }),
      401,
      'INVALID_TOTP',
    );
    const code = codeFor(secret);
    const ok = await post('/api/v1/auth/login/totp', { ticket, code });
    expect(authTokensSchema.parse(ok.json()).user.mfaEnabled).toBe(true);
    expectError(
      await post('/api/v1/auth/login/totp', { ticket: await challenge(account), code }),
      401,
      'INVALID_TOTP',
    );
  });

  it('accepts each recovery code once', async () => {
    const { account, recoveryCodes } = await enrolled();
    const recoveryCode = recoveryCodes[0] ?? '';
    expect(
      (await post('/api/v1/auth/login/totp', { ticket: await challenge(account), recoveryCode }))
        .statusCode,
    ).toBe(200);
    expectError(
      await post('/api/v1/auth/login/totp', { ticket: await challenge(account), recoveryCode }),
      401,
      'INVALID_TOTP',
    );
  });

  it('rejects forged or access tokens as tickets', async () => {
    const { tokens } = await enrolled();
    expectError(
      await post('/api/v1/auth/login/totp', { ticket: tokens.accessToken, code: '123456' }),
      401,
      'TOKEN_INVALID',
    );
    expectError(
      await post('/api/v1/auth/login/totp', { ticket: 'x', code: '12' }),
      400,
      'VALIDATION_FAILED',
    );
  });

  it('disables only with password and a valid code', async () => {
    const { account, tokens, secret } = await enrolled();
    expectError(
      await post(
        '/api/v1/auth/totp/disable',
        { password: 'wrong password', code: codeFor(secret, 1) },
        bearer(tokens),
      ),
      401,
      'INVALID_CREDENTIALS',
    );
    const ok = await post(
      '/api/v1/auth/totp/disable',
      { password: account.password, code: codeFor(secret, 1) },
      bearer(tokens),
    );
    expect(ok.statusCode).toBe(204);
    const login = await post('/api/v1/auth/login', {
      login: account.email,
      password: account.password,
      deviceName: 'Desk',
    });
    expect(authTokensSchema.parse(login.json()).user.mfaEnabled).toBe(false);
  });

  it('refuses a second setup while enabled', async () => {
    const { tokens } = await enrolled();
    expectError(
      await post(
        '/api/v1/auth/totp/setup',
        { password: 'correct horse battery staple' },
        bearer(tokens),
      ),
      409,
      'CONFLICT',
    );
  });

  it('caps second-factor attempts per account across fresh tickets', async () => {
    const limited = await createTestApp({ rateLimits: 'valkey' });
    try {
      await openRegistration(limited);
      const { account, tokens } = await register(limited);
      const setup = totpSetupResponseSchema.parse(
        (
          await limited.request({
            method: 'POST',
            url: '/api/v1/auth/totp/setup',
            headers: bearer(tokens),
            payload: { password: account.password },
          })
        ).json(),
      );
      const enabled = await limited.request({
        method: 'POST',
        url: '/api/v1/auth/totp/enable',
        headers: bearer(tokens),
        payload: { code: codeFor(setup.secret, -1) },
      });
      expect(enabled.statusCode, enabled.body).toBe(200);
      const statuses: number[] = [];
      let ticket = '';
      for (let i = 0; i < 11; i++) {
        if (i < 10) {
          const login = await limited.request({
            method: 'POST',
            url: '/api/v1/auth/login',
            payload: {
              // Alternate identifiers: each has its own 5/min login bucket.
              login: i % 2 === 0 ? account.email : account.username,
              password: account.password,
              deviceName: 'Desk',
            },
            remoteAddress: `10.9.${i}.1`,
          });
          ticket = mfaChallengeSchema.parse(login.json()).ticket;
        }
        // The 11th attempt reuses a ticket with budget left: only the account ceiling can stop it.
        const attempt = await limited.request({
          method: 'POST',
          url: '/api/v1/auth/login/totp',
          payload: { ticket, code: '000000' },
          remoteAddress: `10.9.${i}.2`,
        });
        statuses.push(attempt.statusCode);
      }
      expect(statuses.slice(0, 10)).toEqual(Array(10).fill(401));
      expect(statuses[10]).toBe(429);
    } finally {
      await limited.close();
    }
  });
});
