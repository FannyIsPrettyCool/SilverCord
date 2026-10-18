import { Permission } from '@silvercord/permissions';
import {
  createGuildRequestSchema,
  errorEnvelopeSchema,
  guildListSchema,
  guildParamsSchema,
  guildPatchSchema,
  guildSchema,
} from '@silvercord/protocol';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Database } from '../../db/client.ts';
import { requireAuth } from '../../http/authentication.ts';
import { perUser } from '../../http/rate-limit.ts';
import type { GuildsService } from './guilds-service.ts';

const errors = {
  400: errorEnvelopeSchema,
  401: errorEnvelopeSchema,
  403: errorEnvelopeSchema,
  404: errorEnvelopeSchema,
  409: errorEnvelopeSchema,
  429: errorEnvelopeSchema,
};
const tags = ['guilds'];
const read = [perUser('guild.read', { capacity: 120, refillPerSecond: 4 })];
const write = [perUser('guild.write', { capacity: 10, refillPerSecond: 0.2 })];
const ownGuilds = {
  scope: 'none',
  reason: 'Own membership list and user-locked server creation enforce account limits',
} as const;
const membership = { scope: 'guild', bits: 0n, param: 'guildId' } as const;

export function registerGuildsRoutes(
  app: FastifyInstance,
  db: Database,
  guilds: GuildsService,
): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.get(
    '/api/v1/users/@me/guilds',
    {
      schema: { tags, response: { ...errors, 200: guildListSchema } },
      config: { auth: 'user', permission: ownGuilds, rateLimit: read },
    },
    async (request) => ({ items: await guilds.list(db, requireAuth(request).userId) }),
  );

  r.post(
    '/api/v1/users/@me/guilds',
    {
      schema: { tags, body: createGuildRequestSchema, response: { ...errors, 201: guildSchema } },
      config: { auth: 'user', permission: ownGuilds, rateLimit: write },
    },
    async (request, reply) =>
      reply.code(201).send(await guilds.create(db, requireAuth(request).userId, request.body)),
  );

  r.get(
    '/api/v1/guilds/:guildId',
    {
      schema: { tags, params: guildParamsSchema, response: { ...errors, 200: guildSchema } },
      config: { auth: 'user', permission: membership, rateLimit: read },
    },
    async (request) => guilds.view(db, requireAuth(request).userId, BigInt(request.params.guildId)),
  );

  r.patch(
    '/api/v1/guilds/:guildId',
    {
      schema: {
        tags,
        params: guildParamsSchema,
        body: guildPatchSchema,
        response: { ...errors, 200: guildSchema },
      },
      config: {
        auth: 'user',
        permission: { ...membership, bits: Permission.MANAGE_GUILD },
        rateLimit: write,
      },
    },
    async (request) =>
      guilds.rename(db, requireAuth(request).userId, BigInt(request.params.guildId), request.body),
  );

  r.delete(
    '/api/v1/guilds/:guildId/members/@me',
    {
      schema: { tags, params: guildParamsSchema, response: { ...errors, 204: z.null() } },
      config: { auth: 'user', permission: membership, rateLimit: write },
    },
    async (request, reply) => {
      await guilds.leave(db, requireAuth(request).userId, BigInt(request.params.guildId));
      return reply.code(204).send(null);
    },
  );
}
