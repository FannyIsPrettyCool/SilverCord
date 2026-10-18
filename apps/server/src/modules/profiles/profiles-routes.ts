import {
  customStatusRequestSchema,
  errorEnvelopeSchema,
  guildMemberProfilePatchSchema,
  guildMemberProfileSchema,
  guildParamsSchema,
  ownProfileSchema,
  profileParamsSchema,
  profilePatchSchema,
  profilePrivacySchema,
  profileQuerySchema,
  summariesQuerySchema,
  userProfileSchema,
  userSummariesSchema,
} from '@silvercord/protocol';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Database } from '../../db/client.ts';
import { requireAuth } from '../../http/authentication.ts';
import { perUser } from '../../http/rate-limit.ts';
import type { ProfilesService } from './profiles-service.ts';

const ownAccount = {
  scope: 'none',
  reason: 'Own profile only; the account comes from the access token',
} as const;
const audiences = {
  scope: 'none',
  reason: 'Per-section privacy audiences and guild context membership are enforced in the service',
} as const;
const membership = { scope: 'guild', bits: 0n, param: 'guildId' } as const;
const errors = {
  400: errorEnvelopeSchema,
  401: errorEnvelopeSchema,
  403: errorEnvelopeSchema,
  404: errorEnvelopeSchema,
  409: errorEnvelopeSchema,
  429: errorEnvelopeSchema,
};
const tags = ['profiles'];
const ownRead = [perUser('profile.read', { capacity: 60, refillPerSecond: 2 })];
const write = [perUser('profile.write', { capacity: 10, refillPerSecond: 1 / 3 })];
const viewRead = [perUser('profile.view', { capacity: 30, refillPerSecond: 1 })];
const summariesRead = [perUser('summaries.read', { capacity: 60, refillPerSecond: 2 })];
const statusWrite = [perUser('status.write', { capacity: 10, refillPerSecond: 1 / 5 })];

/** docs/spec/profiles.md */
export function registerProfilesRoutes(
  app: FastifyInstance,
  db: Database,
  profiles: ProfilesService,
): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/api/v1/users/@me/profile',
    {
      schema: { tags, response: { ...errors, 200: ownProfileSchema } },
      config: { auth: 'user', permission: ownAccount, rateLimit: ownRead },
    },
    async (request) => profiles.own(db, requireAuth(request).userId),
  );

  r.patch(
    '/api/v1/users/@me/profile',
    {
      schema: { tags, body: profilePatchSchema, response: { ...errors, 200: ownProfileSchema } },
      config: { auth: 'user', permission: ownAccount, rateLimit: write },
    },
    async (request) => profiles.patch(requireAuth(request).userId, request.body),
  );

  r.put(
    '/api/v1/users/@me/profile/privacy',
    {
      schema: {
        tags,
        body: profilePrivacySchema,
        response: { ...errors, 200: ownProfileSchema },
      },
      config: { auth: 'user', permission: ownAccount, rateLimit: write },
    },
    async (request) => profiles.setPrivacy(requireAuth(request).userId, request.body),
  );

  r.put(
    '/api/v1/users/@me/custom-status',
    {
      schema: { tags, body: customStatusRequestSchema, response: { ...errors, 204: z.null() } },
      config: { auth: 'user', permission: ownAccount, rateLimit: statusWrite },
    },
    async (request, reply) => {
      await profiles.setCustomStatus(requireAuth(request).userId, request.body);
      return reply.code(204).send(null);
    },
  );

  r.delete(
    '/api/v1/users/@me/custom-status',
    {
      schema: { tags, response: { ...errors, 204: z.null() } },
      config: { auth: 'user', permission: ownAccount, rateLimit: statusWrite },
    },
    async (request, reply) => {
      await profiles.setCustomStatus(requireAuth(request).userId, null);
      return reply.code(204).send(null);
    },
  );

  r.get(
    '/api/v1/users/summaries',
    {
      schema: {
        tags,
        querystring: summariesQuerySchema,
        response: { ...errors, 200: userSummariesSchema },
      },
      config: { auth: 'user', permission: audiences, rateLimit: summariesRead },
    },
    async (request) => ({
      items: await profiles.summaries(
        requireAuth(request).userId,
        request.query.userIds.map(BigInt),
        request.query.guildId === undefined ? undefined : BigInt(request.query.guildId),
      ),
    }),
  );

  r.get(
    '/api/v1/users/:userId/profile',
    {
      schema: {
        tags,
        params: profileParamsSchema,
        querystring: profileQuerySchema,
        response: { ...errors, 200: userProfileSchema },
      },
      config: { auth: 'user', permission: audiences, rateLimit: viewRead },
    },
    async (request) =>
      profiles.view(
        requireAuth(request).userId,
        BigInt(request.params.userId),
        request.query.guildId === undefined ? undefined : BigInt(request.query.guildId),
      ),
  );

  r.get(
    '/api/v1/guilds/:guildId/members/@me/profile',
    {
      schema: {
        tags,
        params: guildParamsSchema,
        response: { ...errors, 200: guildMemberProfileSchema },
      },
      config: { auth: 'user', permission: membership, rateLimit: ownRead },
    },
    async (request) =>
      profiles.guildProfile(requireAuth(request).userId, BigInt(request.params.guildId)),
  );

  r.patch(
    '/api/v1/guilds/:guildId/members/@me/profile',
    {
      schema: {
        tags,
        params: guildParamsSchema,
        body: guildMemberProfilePatchSchema,
        response: { ...errors, 200: guildMemberProfileSchema },
      },
      config: { auth: 'user', permission: membership, rateLimit: write },
    },
    async (request) =>
      profiles.patchGuildProfile(
        requireAuth(request).userId,
        BigInt(request.params.guildId),
        request.body,
      ),
  );
}
