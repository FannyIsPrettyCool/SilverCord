import { authTokensSchema, loginResponseSchema, sessionSchema } from '@silvercord/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { bearer, expectError, openRegistration, register } from '../../../test/auth-helpers.ts';
import { createTestApp, type TestApp } from '../../../test/test-app.ts';

describe('login, refresh and sessions', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
    await openRegistration(t);
  });
  afterAll(() => t.close());

  const login = (payload: Record<string, unknown>) =>
    t.request({ method: 'POST', url: '/api/v1/auth/login', payload });
  const refresh = (refreshToken: string) =>
    t.request({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken } });
  const me = (accessToken: string) =>
    t.request({ method: 'GET', url: '/api/v1/users/@me', headers: bearer({ accessToken }) });

  it('logs in by email or username, case-insensitively', async () => {
    const { account } = await register(t);
    for (const id of [account.email.toUpperCase(), account.username]) {
      const response = await login({ login: id, password: account.password, deviceName: 'Laptop' });
      expect(response.statusCode).toBe(200);
      expect(authTokensSchema.safeParse(loginResponseSchema.parse(response.json())).success).toBe(
        true,
      );
    }
  });

  it('gives the same error for unknown accounts and wrong passwords', async () => {
    const { account } = await register(t);
    expectError(
      await login({ login: account.email, password: 'wrong password!', deviceName: 'X' }),
      401,
      'INVALID_CREDENTIALS',
    );
    expectError(
      await login({ login: 'nobody@example.test', password: 'wrong password!', deviceName: 'X' }),
      401,
      'INVALID_CREDENTIALS',
    );
    expectError(await login({ login: account.email }), 400, 'VALIDATION_FAILED');
  });

  it('rotates refresh tokens and revokes the session on reuse', async () => {
    const { tokens } = await register(t);
    const first = await refresh(tokens.refreshToken);
    expect(first.statusCode).toBe(200);
    const rotated = authTokensSchema.parse(first.json());
    expect(rotated.refreshToken).not.toBe(tokens.refreshToken);
    expect((await me(rotated.accessToken)).statusCode).toBe(200);

    // Replaying the old token: the family dies, including the freshly rotated tokens.
    expectError(await refresh(tokens.refreshToken), 401, 'TOKEN_REUSED');
    expectError(await refresh(rotated.refreshToken), 401, 'TOKEN_INVALID');
    expectError(await me(rotated.accessToken), 401, 'TOKEN_INVALID');
  });

  it('lets exactly one of two concurrent refreshes win', async () => {
    const { tokens } = await register(t);
    const results = await Promise.all([refresh(tokens.refreshToken), refresh(tokens.refreshToken)]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 401]);
  });

  it('rejects unknown refresh tokens and malformed bodies', async () => {
    expectError(await refresh('scr_nope'), 401, 'TOKEN_INVALID');
    expectError(
      await t.request({ method: 'POST', url: '/api/v1/auth/refresh', payload: {} }),
      400,
      'VALIDATION_FAILED',
    );
  });

  it('lists, revokes and logs out sessions', async () => {
    const { account, tokens } = await register(t);
    const second = authTokensSchema.parse(
      (
        await login({ login: account.email, password: account.password, deviceName: 'Phone' })
      ).json(),
    );

    const list = await t.request({
      method: 'GET',
      url: '/api/v1/auth/sessions',
      headers: bearer(tokens),
    });
    const sessions = z.array(sessionSchema).parse(list.json());
    expect(sessions).toHaveLength(2);
    expect(sessions.filter((s) => s.current)).toHaveLength(1);

    const other = sessions.find((s) => !s.current);
    if (!other) throw new Error('missing session');
    const revoked = await t.request({
      method: 'DELETE',
      url: `/api/v1/auth/sessions/${other.id}`,
      headers: bearer(tokens),
    });
    expect(revoked.statusCode).toBe(204);
    expectError(await me(second.accessToken), 401, 'TOKEN_INVALID');
    expectError(await refresh(second.refreshToken), 401, 'TOKEN_INVALID');

    const again = await t.request({
      method: 'DELETE',
      url: `/api/v1/auth/sessions/${other.id}`,
      headers: bearer(tokens),
    });
    expectError(again, 404, 'NOT_FOUND');

    expect(
      (await t.request({ method: 'POST', url: '/api/v1/auth/logout', headers: bearer(tokens) }))
        .statusCode,
    ).toBe(204);
    expectError(await me(tokens.accessToken), 401, 'TOKEN_INVALID');
  });

  it("cannot revoke another user's session", async () => {
    const alice = await register(t);
    const bob = await register(t);
    const bobSessions = z.array(sessionSchema).parse(
      (
        await t.request({
          method: 'GET',
          url: '/api/v1/auth/sessions',
          headers: bearer(bob.tokens),
        })
      ).json(),
    );
    const target = bobSessions[0];
    if (!target) throw new Error('missing session');
    const response = await t.request({
      method: 'DELETE',
      url: `/api/v1/auth/sessions/${target.id}`,
      headers: bearer(alice.tokens),
    });
    expectError(response, 404, 'NOT_FOUND');
    expect((await me(bob.tokens.accessToken)).statusCode).toBe(200);
  });

  it('revokes every other session at once', async () => {
    const { account, tokens } = await register(t);
    const other = authTokensSchema.parse(
      (
        await login({ login: account.email, password: account.password, deviceName: 'Tablet' })
      ).json(),
    );
    const response = await t.request({
      method: 'POST',
      url: '/api/v1/auth/sessions/revoke-others',
      headers: bearer(tokens),
    });
    expect(response.statusCode).toBe(204);
    expectError(await me(other.accessToken), 401, 'TOKEN_INVALID');
    expect((await me(tokens.accessToken)).statusCode).toBe(200);
  });

  it('requires authentication on user routes', async () => {
    for (const [method, url] of [
      ['GET', '/api/v1/users/@me'],
      ['GET', '/api/v1/auth/sessions'],
      ['POST', '/api/v1/auth/logout'],
      ['POST', '/api/v1/auth/sessions/revoke-others'],
      ['POST', '/api/v1/auth/totp/setup'],
      ['POST', '/api/v1/auth/email/resend'],
    ] as const) {
      expectError(await t.request({ method, url }), 401, 'UNAUTHENTICATED');
    }
    expectError(await me('not-a-jwt'), 401, 'TOKEN_INVALID');
    expectError(
      await t.request({
        method: 'GET',
        url: '/api/v1/users/@me',
        headers: { authorization: 'Basic abc' },
      }),
      401,
      'TOKEN_INVALID',
    );
  });

  it('keeps instance-admin routes for admins', async () => {
    const { tokens } = await register(t);
    expect(tokens.user.isInstanceAdmin).toBe(false);
    const response = await t.request({
      method: 'POST',
      url: '/api/v1/admin/invites',
      headers: bearer(tokens),
      payload: {},
    });
    expectError(response, 403, 'FORBIDDEN');
  });

  it('emails an alert for a new device but not a known one', async () => {
    const { account } = await register(t);
    const alert = t.mailer.next(account.email);
    await login({ login: account.email, password: account.password, deviceName: 'New Laptop' });
    expect((await alert).subject).toContain('New sign-in');
    const before = t.mailer.sent.filter((m) => m.to === account.email).length;
    await login({ login: account.email, password: account.password, deviceName: 'New Laptop' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(t.mailer.sent.filter((m) => m.to === account.email)).toHaveLength(before);
  });
});
