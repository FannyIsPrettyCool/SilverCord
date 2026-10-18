import {
  channelParamsSchema,
  createMessageRequestSchema,
  editMessageRequestSchema,
  errorEnvelopeSchema,
  idempotencyHeadersSchema,
  messageListQuerySchema,
  messagePageSchema,
  messageParamsSchema,
  messageSchema,
  reactionParamsSchema,
} from '@silvercord/protocol';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Database } from '../../db/client.ts';
import { requireAuth } from '../../http/authentication.ts';
import { perUser } from '../../http/rate-limit.ts';
import type { TypingService } from '../presence/typing-service.ts';
import type { MessagesService } from './messages-service.ts';

const nonGuildAccess = {
  scope: 'none',
  reason: 'Private conversation messages enforce membership and author checks in the service',
} as const;
const errors = {
  400: errorEnvelopeSchema,
  401: errorEnvelopeSchema,
  403: errorEnvelopeSchema,
  404: errorEnvelopeSchema,
  409: errorEnvelopeSchema,
  429: errorEnvelopeSchema,
};
const tags = ['messages'];
const empty = z.strictObject({}).optional();
const chatRead = [perUser('chat.read', { capacity: 120, refillPerSecond: 4 })];
const messageWrite = [perUser('message.write', { capacity: 20, refillPerSecond: 2 })];
const reactionWrite = [perUser('reaction.write', { capacity: 20, refillPerSecond: 2 })];
const ROOT = '/api/v1/channels/:channelId/messages';

/** Message routes (docs/spec/messaging.md). */
export function registerMessagesRoutes(
  app: FastifyInstance,
  db: Database,
  messages: MessagesService,
  typing: TypingService,
): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    ROOT,
    {
      schema: {
        tags,
        params: channelParamsSchema,
        querystring: messageListQuerySchema,
        response: { ...errors, 200: messagePageSchema },
      },
      config: {
        permission: nonGuildAccess,
        auth: 'user',
        rateLimit: chatRead,
      },
    },
    async (request) =>
      messages.page(
        db,
        requireAuth(request).userId,
        BigInt(request.params.channelId),
        request.query,
      ),
  );

  r.get(
    `${ROOT}/:messageId`,
    {
      schema: { tags, params: messageParamsSchema, response: { ...errors, 200: messageSchema } },
      config: {
        permission: nonGuildAccess,
        auth: 'user',
        rateLimit: chatRead,
      },
    },
    async (request) =>
      messages.get(
        db,
        requireAuth(request).userId,
        BigInt(request.params.channelId),
        BigInt(request.params.messageId),
      ),
  );

  r.post(
    ROOT,
    {
      schema: {
        tags,
        params: channelParamsSchema,
        headers: idempotencyHeadersSchema,
        body: createMessageRequestSchema,
        response: { ...errors, 200: messageSchema },
      },
      config: {
        permission: nonGuildAccess,
        auth: 'user',
        rateLimit: [perUser('message.send', { capacity: 10, refillPerSecond: 2 })],
      },
    },
    async (request) => {
      const { userId, sessionId } = requireAuth(request);
      const channelId = BigInt(request.params.channelId);
      const message = await messages.send(
        db,
        userId,
        channelId,
        request.headers['idempotency-key'],
        request.body,
      );
      // Best effort: markers expire on their own within seconds.
      await typing
        .clear(channelId, userId, sessionId)
        .catch((error: unknown) => request.log.warn({ err: error }, 'typing clear failed'));
      return message;
    },
  );

  r.patch(
    `${ROOT}/:messageId`,
    {
      schema: {
        tags,
        params: messageParamsSchema,
        body: editMessageRequestSchema,
        response: { ...errors, 200: messageSchema },
      },
      config: {
        permission: nonGuildAccess,
        auth: 'user',
        rateLimit: messageWrite,
      },
    },
    async (request) =>
      messages.edit(
        db,
        requireAuth(request).userId,
        BigInt(request.params.channelId),
        BigInt(request.params.messageId),
        request.body,
      ),
  );

  r.delete(
    `${ROOT}/:messageId`,
    {
      schema: { tags, params: messageParamsSchema, response: { ...errors, 204: z.null() } },
      config: {
        permission: nonGuildAccess,
        auth: 'user',
        rateLimit: messageWrite,
      },
    },
    async (request, reply) => {
      await messages.remove(
        db,
        requireAuth(request).userId,
        BigInt(request.params.channelId),
        BigInt(request.params.messageId),
      );
      return reply.code(204).send(null);
    },
  );

  const reactionRoute = `${ROOT}/:messageId/reactions/:emoji`;
  const react = (
    request: { params: { channelId: string; messageId: string; emoji: string } } & Parameters<
      typeof requireAuth
    >[0],
    add: boolean,
  ) =>
    messages.react(
      db,
      requireAuth(request).userId,
      BigInt(request.params.channelId),
      BigInt(request.params.messageId),
      request.params.emoji,
      add,
    );

  r.put(
    reactionRoute,
    {
      schema: {
        tags,
        params: reactionParamsSchema,
        body: empty,
        response: { ...errors, 204: z.null() },
      },
      config: {
        permission: nonGuildAccess,
        auth: 'user',
        rateLimit: reactionWrite,
      },
    },
    async (request, reply) => {
      await react(request, true);
      return reply.code(204).send(null);
    },
  );

  r.delete(
    reactionRoute,
    {
      schema: { tags, params: reactionParamsSchema, response: { ...errors, 204: z.null() } },
      config: {
        permission: nonGuildAccess,
        auth: 'user',
        rateLimit: reactionWrite,
      },
    },
    async (request, reply) => {
      await react(request, false);
      return reply.code(204).send(null);
    },
  );
}
