import { healthResponseSchema } from '@silvercord/protocol';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.ts';
import { loadEnv } from './config/env.ts';

describe('GET /health', () => {
  const app = buildApp(loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'silent' }));
  afterAll(() => app.close());

  it('returns a schema-valid payload', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(healthResponseSchema.parse(response.json()).status).toBe('ok');
  });
});
