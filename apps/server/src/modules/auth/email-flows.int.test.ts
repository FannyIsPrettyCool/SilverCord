import { authTokensSchema, currentUserSchema } from '@silvercord/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bearer,
  expectError,
  openRegistration,
  register,
  tokenFromLink,
} from '../../../test/auth-helpers.ts';
import { createTestApp, type TestApp } from '../../../test/test-app.ts';

describe('email verification and password reset', () => {
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

  it('verifies the email with a single-use link', async () => {
    const pending = t.mailer.next.bind(t.mailer);
    const { account, tokens } = await register(t);
    const mail =
      t.mailer.sent.find((m) => m.to === account.email) ?? (await pending(account.email));
    const token = tokenFromLink(mail.text);

    expect((await post('/api/v1/auth/email/verify', { token })).statusCode).toBe(204);
    const me = currentUserSchema.parse(
      (
        await t.request({ method: 'GET', url: '/api/v1/users/@me', headers: bearer(tokens) })
      ).json(),
    );
    expect(me.emailVerified).toBe(true);
    expectError(await post('/api/v1/auth/email/verify', { token }), 401, 'TOKEN_INVALID');
    expectError(await post('/api/v1/auth/email/verify', {}), 400, 'VALIDATION_FAILED');
  });

  it('invalidates the previous link when resending', async () => {
    const { account, tokens } = await register(t);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const first = t.mailer.sent.filter((m) => m.to === account.email).at(-1);
    if (!first) throw new Error('no first mail');
    const next = t.mailer.next(account.email);
    expect((await post('/api/v1/auth/email/resend', undefined, bearer(tokens))).statusCode).toBe(
      204,
    );
    const second = await next;
    expectError(
      await post('/api/v1/auth/email/verify', { token: tokenFromLink(first.text) }),
      401,
      'TOKEN_INVALID',
    );
    expect(
      (await post('/api/v1/auth/email/verify', { token: tokenFromLink(second.text) })).statusCode,
    ).toBe(204);
  });

  it('answers 202 for unknown emails without sending anything', async () => {
    const before = t.mailer.sent.length;
    expect(
      (await post('/api/v1/auth/password/forgot', { email: 'ghost@example.test' })).statusCode,
    ).toBe(202);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(t.mailer.sent.length).toBe(before);
    expectError(
      await post('/api/v1/auth/password/forgot', { email: 'not-an-email' }),
      400,
      'VALIDATION_FAILED',
    );
  });

  it('resets the password, revokes every session and is single-use', async () => {
    const { account, tokens } = await register(t);
    const mail = t.mailer.next(account.email);
    expect((await post('/api/v1/auth/password/forgot', { email: account.email })).statusCode).toBe(
      202,
    );
    const token = tokenFromLink((await mail).text);
    expect((await mail).text).toContain('silvercord://reset-password?token=');

    const newPassword = 'a brand new passphrase';
    expectError(
      await post('/api/v1/auth/password/reset', { token, password: 'short' }),
      400,
      'VALIDATION_FAILED',
    );
    expect(
      (await post('/api/v1/auth/password/reset', { token, password: newPassword })).statusCode,
    ).toBe(204);
    expectError(
      await post('/api/v1/auth/password/reset', { token, password: newPassword }),
      401,
      'TOKEN_INVALID',
    );

    expectError(
      await t.request({ method: 'GET', url: '/api/v1/users/@me', headers: bearer(tokens) }),
      401,
      'TOKEN_INVALID',
    );
    expectError(
      await post('/api/v1/auth/refresh', { refreshToken: tokens.refreshToken }),
      401,
      'TOKEN_INVALID',
    );
    expectError(
      await post('/api/v1/auth/login', {
        login: account.email,
        password: account.password,
        deviceName: 'X',
      }),
      401,
      'INVALID_CREDENTIALS',
    );
    const relogin = await post('/api/v1/auth/login', {
      login: account.email,
      password: newPassword,
      deviceName: 'X',
    });
    expect(authTokensSchema.parse(relogin.json()).user.emailVerified).toBe(true);
  });
});
