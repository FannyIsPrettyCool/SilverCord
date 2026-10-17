import Fastify, { type FastifyInstance } from 'fastify';
import { registerHealthRoutes } from './api/health-routes.ts';
import type { Env } from './config/env.ts';

const VERSION = '0.0.0';

/** Builds the HTTP app without listening, so tests can use `app.inject`. */
export function buildApp(env: Env): FastifyInstance {
  const app = Fastify({
    logger: { level: env.LOG_LEVEL },
    bodyLimit: 1_048_576,
  });
  registerHealthRoutes(app, VERSION);
  return app;
}
