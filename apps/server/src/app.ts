import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { registerHealthRoutes } from './api/health-routes.ts';
import type { Env } from './config/env.ts';
import { registerErrorHandling } from './http/error-handler.ts';
import { registerOpenApi } from './http/openapi.ts';
import { registerRateLimiting } from './http/rate-limit.ts';
import type { RateLimiter } from './infra/rate-limiter.ts';

export const VERSION = '0.0.0';

const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  '*.password',
  '*.token',
  '*.refreshToken',
  '*.totp',
  '*.code',
];

export interface AppDependencies {
  readonly rateLimiter: RateLimiter;
}

/** Builds the HTTP app without listening, so tests can use `app.inject`. */
export async function buildApp(env: Env, deps: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: env.LOG_LEVEL, redact: { paths: REDACTED_PATHS, censor: '[redacted]' } },
    bodyLimit: 1_048_576,
    trustProxy: env.TRUST_PROXY,
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandling(app);
  registerRateLimiting(app, deps.rateLimiter);
  await registerOpenApi(app, VERSION);
  registerHealthRoutes(app, VERSION);
  return app;
}
