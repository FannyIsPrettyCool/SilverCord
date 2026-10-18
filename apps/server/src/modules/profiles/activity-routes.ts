import {
  activityParamsSchema,
  activitySourcesSchema,
  errorEnvelopeSchema,
  ownActivitySchema,
  setActivityRequestSchema,
} from '@silvercord/protocol';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireAuth } from '../../http/authentication.ts';
import { perUser } from '../../http/rate-limit.ts';
import type { ActivityService } from './activity-service.ts';

const ownAccount = {
  scope: 'none',
  reason: 'Own activity only; the account and session come from the access token',
} as const;
const errors = {
  400: errorEnvelopeSchema,
  401: errorEnvelopeSchema,
  403: errorEnvelopeSchema,
  404: errorEnvelopeSchema,
  429: errorEnvelopeSchema,
};
const tags = ['activity'];
const read = [perUser('activity.read', { capacity: 60, refillPerSecond: 2 })];
const write = [perUser('activity.write', { capacity: 20, refillPerSecond: 1 / 3 })];

/** docs/spec/activity.md */
export function registerActivityRoutes(app: FastifyInstance, activity: ActivityService): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/api/v1/users/@me/activity',
    {
      schema: { tags, response: { ...errors, 200: ownActivitySchema } },
      config: { auth: 'user', permission: ownAccount, rateLimit: read },
    },
    async (request) => activity.own(requireAuth(request).userId),
  );

  r.put(
    '/api/v1/users/@me/activity/sources',
    {
      schema: {
        tags,
        body: activitySourcesSchema,
        response: { ...errors, 200: ownActivitySchema },
      },
      config: { auth: 'user', permission: ownAccount, rateLimit: write },
    },
    async (request) => activity.setSources(requireAuth(request).userId, request.body),
  );

  r.put(
    '/api/v1/users/@me/activity/:source',
    {
      schema: {
        tags,
        params: activityParamsSchema,
        body: setActivityRequestSchema,
        response: { ...errors, 204: z.null() },
      },
      config: { auth: 'user', permission: ownAccount, rateLimit: write },
    },
    async (request, reply) => {
      const { userId, sessionId } = requireAuth(request);
      await activity.set(
        userId,
        sessionId,
        request.params.source,
        request.body.activity,
        request.body.expiresAt ?? null,
      );
      return reply.code(204).send(null);
    },
  );

  r.delete(
    '/api/v1/users/@me/activity/:source',
    {
      schema: { tags, params: activityParamsSchema, response: { ...errors, 204: z.null() } },
      config: { auth: 'user', permission: ownAccount, rateLimit: write },
    },
    async (request, reply) => {
      const { userId, sessionId } = requireAuth(request);
      await activity.clear(userId, sessionId, request.params.source);
      return reply.code(204).send(null);
    },
  );
}
