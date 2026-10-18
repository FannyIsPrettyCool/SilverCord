import {
  type Channel,
  channelListQuerySchema,
  channelMemberParamsSchema,
  channelPageSchema,
  channelParamsSchema,
  channelPatchSchema,
  channelSchema,
  errorEnvelopeSchema,
  openChannelRequestSchema,
  type ReadStateView,
  readStateRequestSchema,
  readStateSchema,
} from '@silvercord/protocol';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Database } from '../../db/client.ts';
import { AppError } from '../../http/app-error.ts';
import { requireAuth } from '../../http/authentication.ts';
import { perUser } from '../../http/rate-limit.ts';
import type { MessagesService } from '../messages/messages-service.ts';
import type { TypingService } from '../presence/typing-service.ts';
import type { ChannelBase, ChannelsService } from './channels-service.ts';

const nonGuildAccess = {
  scope: 'none',
  reason: 'Private conversations enforce membership and owner checks in the service',
} as const;
const errors = {
  400: errorEnvelopeSchema,
  401: errorEnvelopeSchema,
  403: errorEnvelopeSchema,
  404: errorEnvelopeSchema,
  409: errorEnvelopeSchema,
  429: errorEnvelopeSchema,
};
const tags = ['channels'];
const empty = z.strictObject({}).optional();
const chatRead = [perUser('chat.read', { capacity: 120, refillPerSecond: 4 })];
const channelWrite = [perUser('channel.write', { capacity: 20, refillPerSecond: 1 })];
const EMPTY_READ_STATE: ReadStateView = {
  lastReadMessageId: null,
  unreadCount: 0,
  mentionCount: 0,
};

function toChannel(base: ChannelBase, readState: ReadStateView | undefined): Channel {
  const { row } = base;
  if (row.type !== 'dm' && row.type !== 'group_dm')
    throw new AppError('INTERNAL', 'Invalid private channel');
  return {
    id: row.id.toString(),
    type: row.type,
    name: row.name,
    ownerId: row.ownerId?.toString() ?? null,
    version: row.version,
    lastMessageId: row.lastMessageId?.toString() ?? null,
    members: base.members,
    readState: readState ?? EMPTY_READ_STATE,
    createdAt: row.createdAt.toISOString(),
  };
}

/** `/api/v1/users/@me/channels` and `/api/v1/channels/:channelId` (docs/spec/messaging.md). */
export function registerChannelsRoutes(
  app: FastifyInstance,
  db: Database,
  channels: ChannelsService,
  messages: MessagesService,
  typing: TypingService,
): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  async function present(viewerId: bigint, bases: ChannelBase[]): Promise<Channel[]> {
    const states = await messages.readStateViews(
      db,
      viewerId,
      bases.map((base) => base.row.id),
    );
    return bases.map((base) => toChannel(base, states.get(base.row.id)));
  }

  r.get(
    '/api/v1/users/@me/channels',
    {
      schema: {
        tags,
        querystring: channelListQuerySchema,
        response: { ...errors, 200: channelPageSchema },
      },
      config: {
        permission: nonGuildAccess,
        auth: 'user',
        rateLimit: chatRead,
      },
    },
    async (request) => {
      const { userId } = requireAuth(request);
      const page = await channels.list(db, userId, request.query);
      return { items: await present(userId, page.items), nextBefore: page.nextBefore };
    },
  );

  r.post(
    '/api/v1/users/@me/channels',
    {
      schema: { tags, body: openChannelRequestSchema, response: { ...errors, 200: channelSchema } },
      config: {
        permission: nonGuildAccess,
        auth: 'user',
        rateLimit: [perUser('channel.open', { capacity: 10, refillPerSecond: 10 / 60 })],
      },
    },
    async (request) => {
      const { userId } = requireAuth(request);
      const [channel] = await present(userId, [await channels.open(db, userId, request.body)]);
      return channel;
    },
  );

  r.get(
    '/api/v1/channels/:channelId',
    {
      schema: { tags, params: channelParamsSchema, response: { ...errors, 200: channelSchema } },
      config: {
        permission: nonGuildAccess,
        auth: 'user',
        rateLimit: chatRead,
      },
    },
    async (request) => {
      const { userId } = requireAuth(request);
      const base = await channels.view(db, userId, BigInt(request.params.channelId));
      const [channel] = await present(userId, [base]);
      return channel;
    },
  );

  r.patch(
    '/api/v1/channels/:channelId',
    {
      schema: {
        tags,
        params: channelParamsSchema,
        body: channelPatchSchema,
        response: { ...errors, 200: channelSchema },
      },
      config: {
        permission: nonGuildAccess,
        auth: 'user',
        rateLimit: channelWrite,
      },
    },
    async (request) => {
      const { userId } = requireAuth(request);
      const base = await channels.rename(
        db,
        userId,
        BigInt(request.params.channelId),
        request.body,
      );
      const [channel] = await present(userId, [base]);
      return channel;
    },
  );

  r.put(
    '/api/v1/channels/:channelId/members/:userId',
    {
      schema: {
        tags,
        params: channelMemberParamsSchema,
        body: empty,
        response: { ...errors, 204: z.null() },
      },
      config: {
        permission: nonGuildAccess,
        auth: 'user',
        rateLimit: channelWrite,
      },
    },
    async (request, reply) => {
      const { userId } = requireAuth(request);
      const { channelId, userId: memberId } = request.params;
      await channels.addMember(db, userId, BigInt(channelId), BigInt(memberId));
      return reply.code(204).send(null);
    },
  );

  r.delete(
    '/api/v1/channels/:channelId/members/:userId',
    {
      schema: { tags, params: channelMemberParamsSchema, response: { ...errors, 204: z.null() } },
      config: {
        permission: nonGuildAccess,
        auth: 'user',
        rateLimit: channelWrite,
      },
    },
    async (request, reply) => {
      const { userId } = requireAuth(request);
      const { channelId, userId: memberId } = request.params;
      await channels.removeMember(db, userId, BigInt(channelId), BigInt(memberId));
      await typing
        .clearUser(BigInt(channelId), BigInt(memberId))
        .catch((error: unknown) => request.log.warn({ err: error }, 'typing clear failed'));
      return reply.code(204).send(null);
    },
  );

  r.put(
    '/api/v1/channels/:channelId/read-state',
    {
      schema: {
        tags,
        params: channelParamsSchema,
        body: readStateRequestSchema,
        response: { ...errors, 200: readStateSchema },
      },
      config: {
        permission: nonGuildAccess,
        auth: 'user',
        rateLimit: [perUser('read.write', { capacity: 30, refillPerSecond: 2 })],
      },
    },
    async (request) => {
      const { userId } = requireAuth(request);
      return messages.markRead(
        db,
        userId,
        BigInt(request.params.channelId),
        BigInt(request.body.messageId),
      );
    },
  );
}
