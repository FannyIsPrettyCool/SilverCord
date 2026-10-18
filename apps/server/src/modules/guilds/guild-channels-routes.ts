import { Permission } from '@silvercord/permissions';
import {
  errorEnvelopeSchema,
  guildChannelCreateSchema,
  guildChannelListSchema,
  guildChannelOrderSchema,
  guildChannelParamsSchema,
  guildChannelPatchSchema,
  guildChannelSchema,
  snowflakeSchema,
} from '@silvercord/protocol';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Database } from '../../db/client.ts';
import { requireAuth } from '../../http/authentication.ts';
import { perUser } from '../../http/rate-limit.ts';
import type { GuildChannelsService } from './guild-channels-service.ts';

const errors = {
  400: errorEnvelopeSchema,
  401: errorEnvelopeSchema,
  403: errorEnvelopeSchema,
  404: errorEnvelopeSchema,
  409: errorEnvelopeSchema,
  429: errorEnvelopeSchema,
};
const guildParams = z.strictObject({ guildId: snowflakeSchema });
const tags = ['guild channels'];
const readLimit = [perUser('guild-channel.read', { capacity: 60, refillPerSecond: 2 })];
const writeLimit = [perUser('guild-channel.write', { capacity: 20, refillPerSecond: 1 })];

export function registerGuildChannelsRoutes(
  app: FastifyInstance,
  db: Database,
  service: GuildChannelsService,
): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.get(
    '/api/v1/guilds/:guildId/channels',
    {
      schema: { tags, params: guildParams, response: { ...errors, 200: guildChannelListSchema } },
      config: {
        auth: 'user',
        permission: { scope: 'guild', param: 'guildId', bits: 0n },
        rateLimit: readLimit,
      },
    },
    async (request) => ({
      items: await service.list(db, requireAuth(request).userId, BigInt(request.params.guildId)),
    }),
  );
  r.post(
    '/api/v1/guilds/:guildId/channels',
    {
      schema: {
        tags,
        params: guildParams,
        body: guildChannelCreateSchema,
        response: { ...errors, 201: guildChannelSchema },
      },
      config: {
        auth: 'user',
        permission: { scope: 'guild', param: 'guildId', bits: Permission.MANAGE_CHANNELS },
        rateLimit: writeLimit,
      },
    },
    async (request, reply) =>
      reply
        .code(201)
        .send(
          await service.create(
            db,
            requireAuth(request).userId,
            BigInt(request.params.guildId),
            request.body,
          ),
        ),
  );
  r.patch(
    '/api/v1/guilds/:guildId/channels/:channelId',
    {
      schema: {
        tags,
        params: guildChannelParamsSchema,
        body: guildChannelPatchSchema,
        response: { ...errors, 200: guildChannelSchema },
      },
      config: {
        auth: 'user',
        permission: {
          scope: 'channel',
          param: 'channelId',
          bits: Permission.VIEW_CHANNEL | Permission.MANAGE_CHANNELS,
        },
        rateLimit: writeLimit,
      },
    },
    async (request) =>
      service.patch(
        db,
        requireAuth(request).userId,
        BigInt(request.params.guildId),
        BigInt(request.params.channelId),
        request.body,
      ),
  );
  r.put(
    '/api/v1/guilds/:guildId/channels/order',
    {
      schema: {
        tags,
        params: guildParams,
        body: guildChannelOrderSchema,
        response: { ...errors, 200: guildChannelListSchema },
      },
      config: {
        auth: 'user',
        permission: { scope: 'guild', param: 'guildId', bits: Permission.MANAGE_CHANNELS },
        rateLimit: writeLimit,
      },
    },
    async (request) => ({
      items: await service.reorder(
        db,
        requireAuth(request).userId,
        BigInt(request.params.guildId),
        request.body,
      ),
    }),
  );
}
