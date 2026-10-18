import {
  channelParamsSchema,
  errorEnvelopeSchema,
  ownPresenceSchema,
  presenceQuerySchema,
  presenceSnapshotSchema,
  typingRequestSchema,
  typingSnapshotSchema,
} from '@silvercord/protocol';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Database } from '../../db/client.ts';
import { requireAuth } from '../../http/authentication.ts';
import { perUser } from '../../http/rate-limit.ts';
import type { PresenceService } from './presence-service.ts';
import type { TypingService } from './typing-service.ts';

const errors = {
  400: errorEnvelopeSchema,
  401: errorEnvelopeSchema,
  403: errorEnvelopeSchema,
  404: errorEnvelopeSchema,
  429: errorEnvelopeSchema,
};
const tags = ['presence'];
const presenceRead = [perUser('presence.read', { capacity: 60, refillPerSecond: 2 })];

/** Presence and typing routes (docs/spec/presence.md). */
export function registerPresenceRoutes(
  app: FastifyInstance,
  db: Database,
  presence: PresenceService,
  typing: TypingService,
): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/api/v1/presence',
    {
      schema: {
        tags,
        querystring: presenceQuerySchema,
        response: { ...errors, 200: presenceSnapshotSchema },
      },
      config: { auth: 'user', rateLimit: presenceRead },
    },
    async (request) =>
      presence.snapshot(db, requireAuth(request).userId, request.query.userIds.map(BigInt)),
  );

  r.get(
    '/api/v1/users/@me/presence',
    {
      schema: { tags, response: { ...errors, 200: ownPresenceSchema } },
      config: { auth: 'user', rateLimit: presenceRead },
    },
    async (request) => presence.preference(db, requireAuth(request).userId),
  );

  r.patch(
    '/api/v1/users/@me/presence',
    {
      schema: { tags, body: ownPresenceSchema, response: { ...errors, 200: ownPresenceSchema } },
      config: {
        auth: 'user',
        rateLimit: [perUser('presence.write', { capacity: 10, refillPerSecond: 1 / 5 })],
      },
    },
    async (request) => presence.setPreference(db, requireAuth(request).userId, request.body.status),
  );

  r.put(
    '/api/v1/channels/:channelId/typing',
    {
      schema: {
        tags,
        params: channelParamsSchema,
        body: typingRequestSchema,
        response: { ...errors, 204: z.null() },
      },
      config: {
        auth: 'user',
        rateLimit: [perUser('typing.write', { capacity: 5, refillPerSecond: 1 / 4 })],
      },
    },
    async (request, reply) => {
      const { userId, sessionId } = requireAuth(request);
      await typing.set(userId, sessionId, BigInt(request.params.channelId), request.body.active);
      return reply.code(204).send(null);
    },
  );

  r.get(
    '/api/v1/channels/:channelId/typing',
    {
      schema: {
        tags,
        params: channelParamsSchema,
        response: { ...errors, 200: typingSnapshotSchema },
      },
      config: {
        auth: 'user',
        rateLimit: [perUser('typing.read', { capacity: 30, refillPerSecond: 2 })],
      },
    },
    async (request) =>
      typing.snapshot(requireAuth(request).userId, BigInt(request.params.channelId)),
  );
}
