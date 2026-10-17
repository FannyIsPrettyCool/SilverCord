import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { BucketPolicy, RateLimiter } from '../infra/rate-limiter.ts';
import { AppError } from './app-error.ts';

export interface RateLimitRule {
  /** Bucket namespace, e.g. `auth.login`. Buckets with the same name share state across routes. */
  readonly name: string;
  readonly policy: BucketPolicy;
  /** Returns the subject key, or null when the rule does not apply (e.g. per-user on anonymous). */
  readonly key: (request: FastifyRequest) => string | null;
}

declare module 'fastify' {
  interface FastifyContextConfig {
    /**
     * Required on every route (BRIEF §8.1). An empty array opts out explicitly, which is
     * reserved for health checks behind the global per-IP bucket.
     */
    rateLimit?: readonly RateLimitRule[];
  }
}

export function perIp(name: string, policy: BucketPolicy): RateLimitRule {
  return { name, policy, key: (request) => request.ip };
}

/** Applies to every request before route rules: coarse flood protection per client IP. */
export const GLOBAL_IP_POLICY: BucketPolicy = { capacity: 120, refillPerSecond: 20 };

export class MissingRateLimitError extends Error {
  readonly code = 'MISSING_RATE_LIMIT';
}

/**
 * Registers the limiter and refuses to register any route that does not declare `rateLimit`.
 * Must be registered before routes. Valkey failures fail closed (the request errors).
 */
export function registerRateLimiting(app: FastifyInstance, limiter: RateLimiter): void {
  app.addHook('onRoute', (route) => {
    if (route.config?.rateLimit === undefined) {
      throw new MissingRateLimitError(`${route.method} ${route.url} has no rateLimit declaration`);
    }
  });

  app.addHook('onRequest', async (request) => {
    const rules = request.routeOptions.config.rateLimit ?? [];
    const global = { name: 'global', policy: GLOBAL_IP_POLICY, key: (r: FastifyRequest) => r.ip };
    for (const rule of [global, ...rules]) {
      const subject = rule.key(request);
      if (subject === null) continue;
      const result = await limiter.consume(`${rule.name}:${subject}`, rule.policy);
      if (!result.allowed) {
        throw new AppError('RATE_LIMITED', 'Too many requests', {
          retryAfterSeconds: Math.max(1, Math.ceil(result.retryAfterMs / 1000)),
        });
      }
    }
  });
}
