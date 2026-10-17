import { healthResponseSchema } from '@silvercord/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../test/test-app.ts';

describe('app', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('serves a schema-valid /health', async () => {
    const response = await t.request({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(healthResponseSchema.parse(response.json()).status).toBe('ok');
  });

  it('publishes an OpenAPI 3.1 document covering the auth routes', async () => {
    const response = await t.request({ method: 'GET', url: '/api/v1/openapi.json' });
    expect(response.statusCode).toBe(200);
    const document = response.json<{ openapi: string; paths: Record<string, unknown> }>();
    expect(document.openapi).toBe('3.1.0');
    const paths = Object.keys(document.paths);
    expect(paths).toEqual(
      expect.arrayContaining(['/health', '/api/v1/auth/login', '/api/v1/users/@me']),
    );
    expect(paths).not.toContain('/api/v1/openapi.json');
  });
});

describe('CORS', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('answers preflights for the desktop renderer origin only', async () => {
    const preflight = (origin: string) =>
      t.request({
        method: 'OPTIONS',
        url: '/api/v1/users/@me',
        headers: {
          origin,
          'access-control-request-method': 'GET',
          'access-control-request-headers': 'authorization',
        },
      });
    const allowed = await preflight('app://bundle');
    expect(allowed.statusCode).toBe(204);
    expect(allowed.headers['access-control-allow-origin']).toBe('app://bundle');
    expect(allowed.headers['access-control-allow-credentials']).toBeUndefined();
    const denied = await preflight('https://evil.example');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });
});
