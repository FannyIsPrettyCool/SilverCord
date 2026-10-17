import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createRateLimiter, type RateLimiter } from './rate-limiter.ts';
import { createValkey, type Valkey } from './valkey.ts';

describe('token bucket rate limiter', () => {
  let valkey: Valkey;
  let limiter: RateLimiter;
  const key = () => `test:${Math.random()}`;

  beforeAll(async () => {
    valkey = createValkey(inject('valkeyUrl'));
    await valkey.connect();
    limiter = createRateLimiter(valkey);
  });
  afterAll(() => valkey.quit());

  it('allows a burst up to capacity, then refuses with a retry hint', async () => {
    const k = key();
    const policy = { capacity: 3, refillPerSecond: 1 };
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await limiter.consume(k, policy));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results[3]?.retryAfterMs).toBeGreaterThan(0);
    expect(results[3]?.retryAfterMs).toBeLessThanOrEqual(1000);
  });

  it('refills over time', async () => {
    const k = key();
    const policy = { capacity: 1, refillPerSecond: 20 };
    expect((await limiter.consume(k, policy)).allowed).toBe(true);
    expect((await limiter.consume(k, policy)).allowed).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect((await limiter.consume(k, policy)).allowed).toBe(true);
  });

  it('stays exact under concurrent consumers', async () => {
    const k = key();
    const policy = { capacity: 50, refillPerSecond: 0.001 };
    const results = await Promise.all(
      Array.from({ length: 200 }, () => limiter.consume(k, policy)),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(50);
  });

  it('expires idle buckets', async () => {
    const k = key();
    await limiter.consume(k, { capacity: 1, refillPerSecond: 1 });
    const ttl = await valkey.pttl(`rl:${k}`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(2000);
  });
});
