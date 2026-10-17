import { healthResponseSchema } from '@silvercord/protocol';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMemoryRateLimiter } from '../test/memory-rate-limiter.ts';
import { buildApp } from './app.ts';
import { loadEnv } from './config/env.ts';

describe('GET /health', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp(loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'silent' }), {
      rateLimiter: createMemoryRateLimiter(),
    });
  });
  afterAll(() => app.close());

  it('returns a schema-valid payload', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(healthResponseSchema.parse(response.json()).status).toBe('ok');
  });
});

describe('GET /api/v1/openapi.json', () => {
  it('publishes an OpenAPI 3.1 document that includes /health', async () => {
    const app = await buildApp(loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'silent' }), {
      rateLimiter: createMemoryRateLimiter(),
    });
    const response = await app.inject({ method: 'GET', url: '/api/v1/openapi.json' });
    await app.close();
    expect(response.statusCode).toBe(200);
    const document = response.json<{ openapi: string; paths: Record<string, unknown> }>();
    expect(document.openapi).toBe('3.1.0');
    expect(Object.keys(document.paths)).toContain('/health');
    expect(Object.keys(document.paths)).not.toContain('/api/v1/openapi.json');
  });
});
