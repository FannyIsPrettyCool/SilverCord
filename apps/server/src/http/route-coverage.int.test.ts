import { ALL_PERMISSIONS, CHANNEL_SCOPE } from '@silvercord/permissions';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, expectError, openRegistration, register } from '../../test/auth-helpers.ts';
import { createTestApp, type TestApp } from '../../test/test-app.ts';
import type { RateLimiter } from '../infra/rate-limiter.ts';
import type { PermissionMetadata } from './permissions.ts';

/**
 * BRIEF §10.2: every route has a working rate limit. Routes come from the OpenAPI document, so
 * a new route is covered automatically. Once `deny` flips, every bucket except the global one
 * refuses; any route that still answers non-429 forgot to declare a limit.
 */
describe('every route enforces its declared rate limit', () => {
  let deny = false;
  const limiter: RateLimiter = {
    consume: async (key) => {
      const allowed = !deny || key.startsWith('global:');
      return { allowed, remaining: allowed ? 1 : 0, retryAfterMs: allowed ? 0 : 1000 };
    },
  };
  let t: TestApp;
  let token = '';
  let paths: Record<
    string,
    Record<
      string,
      {
        requestBody?: unknown;
        parameters?: unknown[];
        'x-permission'?: PermissionMetadata;
      }
    >
  > = {};

  beforeAll(async () => {
    t = await createTestApp({ rateLimiter: limiter });
    await openRegistration(t);
    token = (await register(t)).tokens.accessToken;
    // The OpenAPI route is itself rate limited, so read it before denying everything.
    paths = (await t.request({ method: 'GET', url: '/api/v1/openapi.json' })).json<{
      paths: typeof paths;
    }>().paths;
    deny = true;
  });
  afterAll(() => t.close());

  /** Routes that are rate limited only by the global per-IP bucket, by design. */
  const GLOBAL_ONLY = new Set(['GET /health']);

  it('exports the declared authorization requirement for every documented operation', () => {
    for (const [path, methods] of Object.entries(paths)) {
      for (const [method, operation] of Object.entries(methods)) {
        const label = `${method.toUpperCase()} ${path}`;
        const permission = operation['x-permission'];
        expect(permission, label).toBeDefined();
        if (!permission) throw new Error(`Missing permission metadata: ${label}`);
        if (permission.scope === 'none') {
          expect(permission.reason.trim().length, label).toBeGreaterThan(0);
        } else {
          expect(['guild', 'channel'], label).toContain(permission.scope);
          expect(permission.bits, label).toMatch(/^\d+$/);
          const bits = BigInt(permission.bits);
          expect(bits & ~ALL_PERMISSIONS, label).toBe(0n);
          if (permission.scope === 'channel') expect(bits & ~CHANNEL_SCOPE, label).toBe(0n);
          expect(path, label).toContain(`{${permission.param}}`);
        }
      }
    }
  });

  it('serves the explicitly declared browser preflight route', async () => {
    const response = await t.request({
      method: 'OPTIONS',
      url: '/api/v1/users/@me',
      headers: { origin: 'app://bundle', 'access-control-request-method': 'GET' },
    });
    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('app://bundle');
  });

  it('covers every documented route', async () => {
    const routes = Object.entries(paths).flatMap(([path, methods]) =>
      Object.keys(methods).map((method) => ({ method: method.toUpperCase(), path })),
    );
    expect(routes.length).toBeGreaterThan(15);
    for (const { method, path } of routes) {
      if (GLOBAL_ONLY.has(`${method} ${path}`)) continue;
      const url = path.replace(/\{[^}]+\}/g, '1');
      const response = await t.request({
        method: method as 'GET' | 'POST' | 'DELETE',
        url,
        headers: bearer({ accessToken: token }),
        ...(method === 'GET' || method === 'DELETE' ? {} : { payload: {} }),
      });
      expect(response.statusCode, `${method} ${path}`).toBe(429);
      expectError(response, 429, 'RATE_LIMITED');
    }
  });

  it('rejects malformed bodies and path params on every route that takes them', async () => {
    deny = false;
    try {
      const checked: string[] = [];
      for (const [path, methods] of Object.entries(paths)) {
        for (const [method, operation] of Object.entries(methods)) {
          const hasParams = path.includes('{');
          if (!operation.requestBody && !hasParams) continue;
          const response = await t.request({
            method: method.toUpperCase() as 'POST' | 'DELETE',
            url: path.replace(/\{[^}]+\}/g, 'not-a-snowflake'),
            headers: bearer({ accessToken: token }),
            ...(operation.requestBody
              ? {
                  payload: JSON.stringify(['not', 'an', 'object']),
                  headers: {
                    ...bearer({ accessToken: token }),
                    'content-type': 'application/json',
                  },
                }
              : {}),
          });
          expectError(response, 400, 'VALIDATION_FAILED');
          checked.push(`${method} ${path}`);
        }
      }
      expect(checked.length).toBeGreaterThan(10);
    } finally {
      deny = true;
    }
  });
});
