import {
  errorEnvelopeSchema,
  relationshipListQuerySchema,
  relationshipMetadataSchema,
  relationshipPageSchema,
  relationshipRequestSchema,
  relationshipUserParamsSchema,
  relationshipViewSchema,
  socialPrivacyPatchSchema,
  socialPrivacySchema,
} from '@silvercord/protocol';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Database } from '../../db/client.ts';
import { requireAuth } from '../../http/authentication.ts';
import { perUser } from '../../http/rate-limit.ts';
import type { RelationshipsService } from './relationships-service.ts';

const nonGuildAccess = {
  scope: 'none',
  reason: 'Own-account relationships and privacy checks are enforced in the service',
} as const;
const ROOT = '/api/v1/users/@me';
const errors = {
  400: errorEnvelopeSchema,
  401: errorEnvelopeSchema,
  404: errorEnvelopeSchema,
  429: errorEnvelopeSchema,
  500: errorEnvelopeSchema,
};
const tags = ['relationships'];
const empty = z.strictObject({}).optional();
const read = {
  permission: nonGuildAccess,
  auth: 'user',
  rateLimit: [perUser('social.read', { capacity: 60, refillPerSecond: 2 })],
} as const;
const write = {
  permission: nonGuildAccess,
  auth: 'user',
  rateLimit: [perUser('social.write', { capacity: 20, refillPerSecond: 1 })],
} as const;

export function registerRelationshipsRoutes(
  app: FastifyInstance,
  db: Database,
  service: RelationshipsService,
) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.get(
    `${ROOT}/relationships`,
    {
      schema: {
        tags,
        querystring: relationshipListQuerySchema,
        response: { ...errors, 200: relationshipPageSchema },
      },
      config: read,
    },
    async (request) => service.list(db, requireAuth(request).userId, request.query),
  );
  r.post(
    `${ROOT}/relationships`,
    {
      schema: {
        tags,
        body: relationshipRequestSchema,
        response: { ...errors, 200: relationshipViewSchema },
      },
      config: {
        permission: nonGuildAccess,
        auth: 'user',
        rateLimit: [perUser('social.request', { capacity: 10, refillPerSecond: 10 / 3600 })],
      },
    },
    async (request) => service.request(db, requireAuth(request).userId, request.body.username),
  );
  r.put(
    `${ROOT}/relationships/:userId/accept`,
    {
      schema: {
        tags,
        params: relationshipUserParamsSchema,
        body: empty,
        response: { ...errors, 200: relationshipViewSchema },
      },
      config: write,
    },
    async (request) =>
      service.accept(db, requireAuth(request).userId, BigInt(request.params.userId)),
  );
  r.delete(
    `${ROOT}/relationships/:userId`,
    {
      schema: {
        tags,
        params: relationshipUserParamsSchema,
        response: { ...errors, 204: z.null() },
      },
      config: write,
    },
    async (request, reply) => {
      await service.remove(db, requireAuth(request).userId, BigInt(request.params.userId));
      return reply.code(204).send(null);
    },
  );
  r.put(
    `${ROOT}/blocks/:userId`,
    {
      schema: {
        tags,
        params: relationshipUserParamsSchema,
        body: empty,
        response: { ...errors, 204: z.null() },
      },
      config: write,
    },
    async (request, reply) => {
      await service.block(db, requireAuth(request).userId, BigInt(request.params.userId));
      return reply.code(204).send(null);
    },
  );
  r.delete(
    `${ROOT}/blocks/:userId`,
    {
      schema: {
        tags,
        params: relationshipUserParamsSchema,
        response: { ...errors, 204: z.null() },
      },
      config: write,
    },
    async (request, reply) => {
      await service.unblock(db, requireAuth(request).userId, BigInt(request.params.userId));
      return reply.code(204).send(null);
    },
  );
  r.put(
    `${ROOT}/relationships/:userId/metadata`,
    {
      schema: {
        tags,
        params: relationshipUserParamsSchema,
        body: relationshipMetadataSchema,
        response: { ...errors, 200: relationshipMetadataSchema },
      },
      config: write,
    },
    async (request) =>
      service.metadata(
        db,
        requireAuth(request).userId,
        BigInt(request.params.userId),
        request.body,
      ),
  );
  r.get(
    `${ROOT}/privacy`,
    {
      schema: { tags, response: { ...errors, 200: socialPrivacySchema } },
      config: read,
    },
    async (request) => service.privacy(db, requireAuth(request).userId),
  );
  r.patch(
    `${ROOT}/privacy`,
    {
      schema: {
        tags,
        body: socialPrivacyPatchSchema,
        response: { ...errors, 200: socialPrivacySchema },
      },
      config: write,
    },
    async (request) => service.setPrivacy(db, requireAuth(request).userId, request.body),
  );
}
