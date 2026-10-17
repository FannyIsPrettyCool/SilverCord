import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectError, newAccount, openRegistration } from '../../../test/auth-helpers.ts';
import { createTestApp, type TestApp } from '../../../test/test-app.ts';

/** Exercises the real Valkey limiter through the HTTP stack, one bucket per route. */
describe('auth rate limits', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ rateLimits: 'valkey' });
    await openRegistration(t);
  });
  afterAll(() => t.close());

  async function exhaust(attempts: number, send: (i: number) => ReturnType<TestApp['request']>) {
    const statuses: number[] = [];
    for (let i = 0; i < attempts; i++) statuses.push((await send(i)).statusCode);
    return statuses;
  }

  it('limits registration per IP', async () => {
    const statuses = await exhaust(6, () =>
      t.request({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: newAccount(),
        remoteAddress: '10.1.0.1',
      }),
    );
    expect(statuses.slice(0, 5).every((s) => s !== 429)).toBe(true);
    expect(statuses[5]).toBe(429);
  });

  it('limits login attempts per account across IPs', async () => {
    const statuses = await exhaust(6, (i) =>
      t.request({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { login: 'victim@example.test', password: 'guess guess guess', deviceName: 'X' },
        remoteAddress: `10.2.0.${i + 1}`,
      }),
    );
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses[5]).toBe(429);
  });

  it('limits forgot-password per email and sets Retry-After', async () => {
    let last: Awaited<ReturnType<TestApp['request']>> | undefined;
    for (let i = 0; i < 4; i++) {
      last = await t.request({
        method: 'POST',
        url: '/api/v1/auth/password/forgot',
        payload: { email: 'target@example.test' },
        remoteAddress: `10.3.0.${i + 1}`,
      });
    }
    if (!last) throw new Error('no response');
    expectError(last, 429, 'RATE_LIMITED');
    expect(Number(last.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('limits refresh and email verification per IP', async () => {
    const refresh = await exhaust(31, () =>
      t.request({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        payload: { refreshToken: 'scr_x' },
        remoteAddress: '10.4.0.1',
      }),
    );
    expect(refresh.at(-1)).toBe(429);
    const verify = await exhaust(11, () =>
      t.request({
        method: 'POST',
        url: '/api/v1/auth/email/verify',
        payload: { token: 'sce_x' },
        remoteAddress: '10.5.0.1',
      }),
    );
    expect(verify.at(-1)).toBe(429);
  });

  it('limits second-factor attempts per IP', async () => {
    const statuses = await exhaust(6, () =>
      t.request({
        method: 'POST',
        url: '/api/v1/auth/login/totp',
        payload: { ticket: 'x', code: '123456' },
        remoteAddress: '10.6.0.1',
      }),
    );
    expect(statuses.at(-1)).toBe(429);
  });
});
