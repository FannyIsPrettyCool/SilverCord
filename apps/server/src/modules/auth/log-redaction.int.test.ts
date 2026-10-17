import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, newAccount, openRegistration, register } from '../../../test/auth-helpers.ts';
import { createTestApp, type TestApp } from '../../../test/test-app.ts';

describe('log redaction (threat model T16)', () => {
  const lines: string[] = [];
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ logLines: lines });
    await openRegistration(t);
  });
  afterAll(() => t.close());

  it('never writes passwords or tokens, even at trace level', async () => {
    const { account, tokens } = await register(t);
    await t.request({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { login: account.email, password: account.password, deviceName: 'X' },
    });
    await t.request({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: tokens.refreshToken },
    });
    await t.request({ method: 'GET', url: '/api/v1/users/@me', headers: bearer(tokens) });
    await t.request({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: newAccount({ password: 'x' }),
    });

    const log = lines.join('');
    expect(lines.length).toBeGreaterThan(0);
    for (const secret of [account.password, tokens.accessToken, tokens.refreshToken]) {
      expect(log).not.toContain(secret);
    }
  });
});
