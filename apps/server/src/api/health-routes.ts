import { healthResponseSchema } from '@silvercord/protocol';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

export function registerHealthRoutes(app: FastifyInstance, version: string): void {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/health',
    {
      schema: { response: { 200: healthResponseSchema } },
      // Polled by healthchecks; only the global per-IP bucket applies.
      config: { auth: 'public', rateLimit: [] },
    },
    async () => ({
      status: 'ok' as const,
      service: 'api',
      version,
      uptimeSeconds: process.uptime(),
    }),
  );
}
