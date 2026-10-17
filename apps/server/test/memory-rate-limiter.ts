import type { BucketPolicy, RateLimiter } from '../src/infra/rate-limiter.ts';

/** In-memory limiter without refill: deterministic for unit tests. Records every key consumed. */
export function createMemoryRateLimiter(): RateLimiter & { readonly keys: string[] } {
  const used = new Map<string, number>();
  const keys: string[] = [];
  return {
    keys,
    async consume(key: string, policy: BucketPolicy) {
      keys.push(key);
      const count = (used.get(key) ?? 0) + 1;
      used.set(key, count);
      const allowed = count <= policy.capacity;
      return {
        allowed,
        remaining: Math.max(0, policy.capacity - count),
        retryAfterMs: allowed ? 0 : 1500,
      };
    },
  };
}
