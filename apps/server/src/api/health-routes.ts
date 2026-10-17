import type { HealthResponse } from '@silvercord/protocol';
import type { FastifyInstance } from 'fastify';

export function registerHealthRoutes(app: FastifyInstance, version: string): void {
  app.get(
    '/health',
    async (): Promise<HealthResponse> => ({
      status: 'ok',
      service: 'api',
      version,
      uptimeSeconds: process.uptime(),
    }),
  );
}
