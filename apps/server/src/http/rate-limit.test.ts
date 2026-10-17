import { errorEnvelopeSchema } from '@silvercord/protocol';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { createMemoryRateLimiter as memoryLimiter } from '../../test/memory-rate-limiter.ts';
import { registerErrorHandling } from './error-handler.ts';
import { MissingRateLimitError, perIp, registerRateLimiting } from './rate-limit.ts';

describe('rate limiting plugin', () => {
  it('rejects routes without a rateLimit declaration', async () => {
    const app = Fastify({ logger: false });
    registerRateLimiting(app, memoryLimiter());
    expect(() => app.get('/naked', () => 'x')).toThrow(MissingRateLimitError);
    await app.close();
  });

  it('enforces route rules after the global bucket and returns the envelope', async () => {
    const app = Fastify({ logger: false });
    const limiter = memoryLimiter();
    registerErrorHandling(app);
    registerRateLimiting(app, limiter);
    app.get(
      '/login',
      { config: { rateLimit: [perIp('auth.login', { capacity: 2, refillPerSecond: 1 })] } },
      () => 'ok',
    );
    await app.ready();

    const statuses = [];
    for (let i = 0; i < 3; i++)
      statuses.push((await app.inject({ method: 'GET', url: '/login' })).statusCode);
    expect(statuses).toEqual([200, 200, 429]);

    const limited = await app.inject({ method: 'GET', url: '/login' });
    expect(limited.headers['retry-after']).toBe('2');
    expect(errorEnvelopeSchema.parse(limited.json()).error.code).toBe('RATE_LIMITED');
    expect(limiter.keys.slice(0, 2)).toEqual(['global:127.0.0.1', 'auth.login:127.0.0.1']);
    await app.close();
  });

  it('skips rules whose key is null', async () => {
    const app = Fastify({ logger: false });
    const limiter = memoryLimiter();
    registerRateLimiting(app, limiter);
    const never = { name: 'user', policy: { capacity: 0, refillPerSecond: 1 }, key: () => null };
    app.get('/anon', { config: { rateLimit: [never] } }, () => 'ok');
    expect((await app.inject({ method: 'GET', url: '/anon' })).statusCode).toBe(200);
    await app.close();
  });
});
