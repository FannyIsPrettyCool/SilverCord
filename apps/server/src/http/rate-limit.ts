import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { BucketPolicy, RateLimiter } from '../infra/rate-limiter.ts';
import { AppError } from './app-error.ts';
import { clientSubject } from './client-subject.ts';

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
  return { name, policy, key: (request) => clientSubject(request.ip) };
}

/** Keyed by the authenticated user; skipped for anonymous requests. */
export function perUser(name: string, policy: BucketPolicy): RateLimitRule {
  return { name, policy, key: (request) => request.auth?.userId.toString() ?? null };
}

/**
 * Keyed by a string field of the (not yet validated) JSON body, lowercased, e.g. the login
 * identifier, so one account can't be brute-forced from many IPs.
 */
export function perBodyField(name: string, policy: BucketPolicy, field: string): RateLimitRule {
  return {
    name,
    policy,
    key: (request) => {
      const body: unknown = request.body;
      if (typeof body !== 'object' || body === null || !(field in body)) return null;
      const value: unknown = (body as Record<string, unknown>)[field];
      if (typeof value !== 'string' || value.length === 0) return null;
      // Unvalidated input: hash it so a huge value can't become a huge Valkey key, and send
      // anything far over every schema limit to one shared bucket.
      if (value.length > MAX_KEYED_FIELD_LENGTH) return 'oversize';
      return createHash('sha256').update(value.trim().toLowerCase()).digest('base64url');
    },
  };
}

/** Longer than any field a body-keyed rule is used on (emails 254, tickets ~600). */
const MAX_KEYED_FIELD_LENGTH = 4096;

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

  async function enforce(request: FastifyRequest, rules: readonly RateLimitRule[]) {
    for (const rule of rules) {
      const subject = rule.key(request);
      if (subject === null) continue;
      const result = await limiter.consume(`${rule.name}:${subject}`, rule.policy);
      if (!result.allowed) {
        throw new AppError('RATE_LIMITED', 'Too many requests', {
          retryAfterSeconds: Math.max(1, Math.ceil(result.retryAfterMs / 1000)),
        });
      }
    }
  }

  // Global flood guard before anything else runs.
  app.addHook('onRequest', (request) => enforce(request, [perIp('global', GLOBAL_IP_POLICY)]));
  // Route rules after body parsing (body-keyed rules) and authentication (user-keyed rules),
  // but before validation and the handler.
  app.addHook('preValidation', (request) =>
    enforce(request, request.routeOptions.config.rateLimit ?? []),
  );
}
