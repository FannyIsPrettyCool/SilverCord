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
