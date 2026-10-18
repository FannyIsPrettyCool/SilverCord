import {
  awardBadgeRequestSchema,
  badgeAwardListSchema,
  badgeAwardParamsSchema,
  badgeAwardSchema,
  badgeDefinitionListSchema,
  badgeDefinitionSchema,
  badgeParamsSchema,
  badgePatchSchema,
  badgePinsRequestSchema,
  createBadgeRequestSchema,
  errorEnvelopeSchema,
} from '@silvercord/protocol';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireAuth } from '../../http/authentication.ts';
import { perUser } from '../../http/rate-limit.ts';
import type { BadgesService } from './badges-service.ts';

const ownBadges = {
  scope: 'none',
  reason: 'Badge definitions are instance-wide; awards and pins are the caller’s own',
} as const;
const administration = {
  scope: 'none',
  reason: 'Instance-wide operation protected by instance-admin authentication',
} as const;
const errors = {
  400: errorEnvelopeSchema,
  401: errorEnvelopeSchema,
  403: errorEnvelopeSchema,
  404: errorEnvelopeSchema,
  409: errorEnvelopeSchema,
  429: errorEnvelopeSchema,
};
const tags = ['badges'];
const read = [perUser('badges.read', { capacity: 30, refillPerSecond: 1 })];
const write = [perUser('badges.write', { capacity: 10, refillPerSecond: 1 / 3 })];
const admin = [perUser('admin.badges', { capacity: 30, refillPerSecond: 30 / 3600 })];

/** docs/spec/badges.md */
export function registerBadgesRoutes(app: FastifyInstance, badges: BadgesService): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/api/v1/badges',
    {
      schema: { tags, response: { ...errors, 200: badgeDefinitionListSchema } },
      config: { auth: 'user', permission: ownBadges, rateLimit: read },
    },
    async (request) => ({ items: await badges.definitions(requireAuth(request).userId) }),
  );

  r.get(
    '/api/v1/users/@me/badges',
    {
      schema: { tags, response: { ...errors, 200: badgeAwardListSchema } },
      config: { auth: 'user', permission: ownBadges, rateLimit: read },
    },
    async (request) => ({ items: await badges.own(requireAuth(request).userId) }),
  );

  r.put(
    '/api/v1/users/@me/badges/pins',
    {
      schema: {
        tags,
        body: badgePinsRequestSchema,
        response: { ...errors, 200: badgeAwardListSchema },
      },
      config: { auth: 'user', permission: ownBadges, rateLimit: write },
    },
    async (request) => ({
      items: await badges.setPins(requireAuth(request).userId, request.body.badgeIds),
    }),
  );

  r.post(
    '/api/v1/admin/badges',
    {
      schema: {
        tags,
        body: createBadgeRequestSchema,
        response: { ...errors, 201: badgeDefinitionSchema },
      },
      config: { auth: 'instance-admin', permission: administration, rateLimit: admin },
    },
    async (request, reply) =>
      reply.code(201).send(await badges.create(requireAuth(request).userId, request.body)),
  );

  r.patch(
    '/api/v1/admin/badges/:badgeId',
    {
      schema: {
        tags,
        params: badgeParamsSchema,
        body: badgePatchSchema,
        response: { ...errors, 200: badgeDefinitionSchema },
      },
      config: { auth: 'instance-admin', permission: administration, rateLimit: admin },
    },
    async (request) =>
      badges.update(requireAuth(request).userId, BigInt(request.params.badgeId), request.body),
  );

  r.post(
    '/api/v1/admin/badges/:badgeId/awards',
    {
      schema: {
        tags,
        params: badgeParamsSchema,
        body: awardBadgeRequestSchema,
        response: { ...errors, 200: badgeAwardSchema },
      },
      config: { auth: 'instance-admin', permission: administration, rateLimit: admin },
    },
    async (request) =>
      badges.award(
        requireAuth(request).userId,
        BigInt(request.params.badgeId),
        request.body.username,
        request.body.reason ?? null,
      ),
  );

  r.delete(
    '/api/v1/admin/badges/:badgeId/awards/:userId',
    {
      schema: { tags, params: badgeAwardParamsSchema, response: { ...errors, 204: z.null() } },
      config: { auth: 'instance-admin', permission: administration, rateLimit: admin },
    },
    async (request, reply) => {
      await badges.revoke(
        requireAuth(request).userId,
        BigInt(request.params.badgeId),
        BigInt(request.params.userId),
      );
      return reply.code(204).send(null);
    },
  );
}
