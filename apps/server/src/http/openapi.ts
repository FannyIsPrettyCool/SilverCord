import fastifySwagger from '@fastify/swagger';
import { BRAND } from '@silvercord/protocol';
import type { FastifyInstance } from 'fastify';
import { jsonSchemaTransform } from 'fastify-type-provider-zod';

/**
 * Generates the OpenAPI document from the same Zod schemas that validate requests, and serves it
 * at `/api/v1/openapi.json` (BRIEF §5.1). Must be registered before any route.
 */
export async function registerOpenApi(app: FastifyInstance, version: string): Promise<void> {
  await app.register(fastifySwagger, {
    openapi: {
      openapi: '3.1.0',
      info: { title: `${BRAND.name} API`, version },
      components: {
        securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      },
    },
    transform: jsonSchemaTransform,
  });
  app.get('/api/v1/openapi.json', { schema: { hide: true } }, () => app.swagger());
}
