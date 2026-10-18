import { Permission } from '@silvercord/permissions';
import {
  createEmoteRequestSchema,
  createStickerRequestSchema,
  emoteParamsSchema,
  emotePatchSchema,
  emoteSchema,
  errorEnvelopeSchema,
  expressionLookupQuerySchema,
  expressionLookupSchema,
  guildExpressionsSchema,
  guildParamsSchema,
  stickerParamsSchema,
  stickerPatchSchema,
  stickerSchema,
  usableExpressionsSchema,
} from '@silvercord/protocol';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireAuth } from '../../http/authentication.ts';
import { perUser } from '../../http/rate-limit.ts';
import type { ExpressionsService } from './expressions-service.ts';

const membership = { scope: 'guild', bits: 0n, param: 'guildId' } as const;
const managers = { scope: 'guild', bits: Permission.MANAGE_EMOJIS, param: 'guildId' } as const;
const ownGuilds = {
  scope: 'none',
  reason: 'Only guilds the caller belongs to, resolved from the access token',
} as const;
const lookupAccess = {
  scope: 'none',
  reason: 'Live emotes and stickers are visible to every signed-in user (ADR-0011)',
} as const;
const errors = {
  400: errorEnvelopeSchema,
  401: errorEnvelopeSchema,
  403: errorEnvelopeSchema,
  404: errorEnvelopeSchema,
  409: errorEnvelopeSchema,
  429: errorEnvelopeSchema,
};
const tags = ['expressions'];
const read = [perUser('expressions.read', { capacity: 30, refillPerSecond: 1 })];
const write = [perUser('expressions.write', { capacity: 20, refillPerSecond: 1 / 3 })];
const lookup = [perUser('expressions.lookup', { capacity: 120, refillPerSecond: 4 })];

/** docs/spec/expressions.md */
export function registerExpressionsRoutes(
  app: FastifyInstance,
  expressions: ExpressionsService,
): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const ids = (request: { params: { guildId: string } }) => BigInt(request.params.guildId);

  r.get(
    '/api/v1/guilds/:guildId/expressions',
    {
      schema: {
        tags,
        params: guildParamsSchema,
        response: { ...errors, 200: guildExpressionsSchema },
      },
      config: { auth: 'user', permission: membership, rateLimit: read },
    },
    async (request) => expressions.guild(requireAuth(request).userId, ids(request)),
  );

  r.get(
    '/api/v1/users/@me/expressions',
    {
      schema: { tags, response: { ...errors, 200: usableExpressionsSchema } },
      config: { auth: 'user', permission: ownGuilds, rateLimit: read },
    },
    async (request) => expressions.usable(requireAuth(request).userId),
  );

  r.get(
    '/api/v1/expressions/lookup',
    {
      schema: {
        tags,
        querystring: expressionLookupQuerySchema,
        response: { ...errors, 200: expressionLookupSchema },
      },
      config: { auth: 'user', permission: lookupAccess, rateLimit: lookup },
    },
    async (request) =>
      expressions.lookup(request.query.emoteIds ?? [], request.query.stickerIds ?? []),
  );

  r.post(
    '/api/v1/guilds/:guildId/emotes',
    {
      schema: {
        tags,
        params: guildParamsSchema,
        body: createEmoteRequestSchema,
        response: { ...errors, 201: emoteSchema },
      },
      config: { auth: 'user', permission: managers, rateLimit: write },
    },
    async (request, reply) =>
      reply
        .code(201)
        .send(
          await expressions.createEmote(
            requireAuth(request).userId,
            ids(request),
            request.body.name,
            request.body.uploadId,
          ),
        ),
  );

  r.patch(
    '/api/v1/guilds/:guildId/emotes/:emoteId',
    {
      schema: {
        tags,
        params: emoteParamsSchema,
        body: emotePatchSchema,
        response: { ...errors, 200: emoteSchema },
      },
      config: { auth: 'user', permission: managers, rateLimit: write },
    },
    async (request) =>
      expressions.renameEmote(
        requireAuth(request).userId,
        ids(request),
        BigInt(request.params.emoteId),
        request.body.name,
      ),
  );

  r.delete(
    '/api/v1/guilds/:guildId/emotes/:emoteId',
    {
      schema: { tags, params: emoteParamsSchema, response: { ...errors, 204: z.null() } },
      config: { auth: 'user', permission: managers, rateLimit: write },
    },
    async (request, reply) => {
      await expressions.deleteEmote(
        requireAuth(request).userId,
        ids(request),
        BigInt(request.params.emoteId),
      );
      return reply.code(204).send(null);
    },
  );

  r.post(
    '/api/v1/guilds/:guildId/stickers',
    {
      schema: {
        tags,
        params: guildParamsSchema,
        body: createStickerRequestSchema,
        response: { ...errors, 201: stickerSchema },
      },
      config: { auth: 'user', permission: managers, rateLimit: write },
    },
    async (request, reply) =>
      reply
        .code(201)
        .send(
          await expressions.createSticker(requireAuth(request).userId, ids(request), request.body),
        ),
  );

  r.patch(
    '/api/v1/guilds/:guildId/stickers/:stickerId',
    {
      schema: {
        tags,
        params: stickerParamsSchema,
        body: stickerPatchSchema,
        response: { ...errors, 200: stickerSchema },
      },
      config: { auth: 'user', permission: managers, rateLimit: write },
    },
    async (request) =>
      expressions.updateSticker(
        requireAuth(request).userId,
        ids(request),
        BigInt(request.params.stickerId),
        request.body,
      ),
  );

  r.delete(
    '/api/v1/guilds/:guildId/stickers/:stickerId',
    {
      schema: { tags, params: stickerParamsSchema, response: { ...errors, 204: z.null() } },
      config: { auth: 'user', permission: managers, rateLimit: write },
    },
    async (request, reply) => {
      await expressions.deleteSticker(
        requireAuth(request).userId,
        ids(request),
        BigInt(request.params.stickerId),
      );
      return reply.code(204).send(null);
    },
  );
}
