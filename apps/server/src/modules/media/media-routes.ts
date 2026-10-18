import type { Readable } from 'node:stream';
import {
  attachmentSchema,
  channelParamsSchema,
  createUploadRequestSchema,
  errorEnvelopeSchema,
  mediaVariantSchema,
  snowflakeSchema,
  uploadChunkHeadersSchema,
  uploadOffsetSchema,
  uploadParamsSchema,
  uploadSchema,
} from '@silvercord/protocol';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError } from '../../http/app-error.ts';
import { requireAuth } from '../../http/authentication.ts';
import { perUser } from '../../http/rate-limit.ts';
import type { MediaService } from './media-service.ts';
import type { StorageDriver } from './storage.ts';

const errors = {
  400: errorEnvelopeSchema,
  401: errorEnvelopeSchema,
  403: errorEnvelopeSchema,
  404: errorEnvelopeSchema,
  409: errorEnvelopeSchema,
  413: errorEnvelopeSchema,
  429: errorEnvelopeSchema,
};
const tags = ['media'];
const uploadRead = [perUser('upload.read', { capacity: 60, refillPerSecond: 2 })];
const uploadWrite = [perUser('upload.write', { capacity: 10, refillPerSecond: 1 })];
/** Rendering a channel fetches many thumbnails at once; clients cache blobs per session. */
const mediaFetch = [perUser('media.fetch', { capacity: 300, refillPerSecond: 10 })];

const mediaParamsSchema = z.strictObject({
  uploadId: snowflakeSchema,
  variant: mediaVariantSchema,
  hash: z.string().regex(/^[a-f0-9]{64}$/),
});

/** RFC 6266/5987 attachment disposition; the display name never reaches a filesystem path. */
function disposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/** Upload and delivery routes (docs/spec/media.md, ADR-0009). */
export async function registerMediaRoutes(
  app: FastifyInstance,
  media: MediaService,
  storage: StorageDriver,
): Promise<void> {
  // Encapsulated: the raw stream parser applies to these routes only.
  await app.register(async (scope) => {
    scope.addContentTypeParser('application/octet-stream', (_request, payload, done) =>
      done(null, payload),
    );
    const r = scope.withTypeProvider<ZodTypeProvider>();

    r.post(
      '/api/v1/channels/:channelId/uploads',
      {
        schema: {
          tags,
          params: channelParamsSchema,
          body: createUploadRequestSchema,
          response: { ...errors, 200: uploadSchema },
        },
        config: {
          auth: 'user',
          rateLimit: [perUser('upload.create', { capacity: 5, refillPerSecond: 5 / 60 })],
        },
      },
      async (request) =>
        media.create(requireAuth(request).userId, BigInt(request.params.channelId), request.body),
    );

    r.put(
      '/api/v1/uploads/:uploadId/chunks',
      {
        schema: {
          tags,
          params: uploadParamsSchema,
          headers: uploadChunkHeadersSchema,
          response: { ...errors, 200: uploadOffsetSchema },
        },
        config: {
          auth: 'user',
          rateLimit: [perUser('upload.chunk', { capacity: 20, refillPerSecond: 2 })],
        },
      },
      async (request) => {
        const body = request.body as Readable | undefined;
        if (!body || typeof body.pipe !== 'function')
          throw new AppError('VALIDATION_FAILED', 'Chunk body required');
        return media.appendChunk(
          requireAuth(request).userId,
          BigInt(request.params.uploadId),
          request.headers['upload-offset'],
          request.headers['content-length'],
          body,
        );
      },
    );

    r.get(
      '/api/v1/uploads/:uploadId',
      {
        schema: { tags, params: uploadParamsSchema, response: { ...errors, 200: uploadSchema } },
        config: { auth: 'user', rateLimit: uploadRead },
      },
      async (request) => media.get(requireAuth(request).userId, BigInt(request.params.uploadId)),
    );

    r.post(
      '/api/v1/uploads/:uploadId/complete',
      {
        schema: {
          tags,
          params: uploadParamsSchema,
          body: z.strictObject({}).optional(),
          response: { ...errors, 200: uploadSchema },
        },
        config: { auth: 'user', rateLimit: uploadWrite },
      },
      async (request) =>
        media.complete(requireAuth(request).userId, BigInt(request.params.uploadId)),
    );

    r.delete(
      '/api/v1/uploads/:uploadId',
      {
        schema: { tags, params: uploadParamsSchema, response: { ...errors, 204: z.null() } },
        config: { auth: 'user', rateLimit: uploadWrite },
      },
      async (request, reply) => {
        await media.remove(requireAuth(request).userId, BigInt(request.params.uploadId));
        return reply.code(204).send(null);
      },
    );

    r.get(
      '/api/v1/attachments/:uploadId',
      {
        schema: {
          tags,
          params: uploadParamsSchema,
          response: { ...errors, 200: attachmentSchema },
        },
        config: { auth: 'user', rateLimit: uploadRead },
      },
      async (request) =>
        media.attachmentFor(requireAuth(request).userId, BigInt(request.params.uploadId)),
    );

    r.get(
      '/media/:uploadId/:variant/:hash',
      {
        // Binary stream: no response serializer; errors still use the shared envelope.
        schema: { tags, params: mediaParamsSchema },
        config: { auth: 'user', rateLimit: mediaFetch },
      },
      async (request, reply) => {
        const { uploadId, variant, hash } = request.params;
        const found = await media.authorizeFetch(
          requireAuth(request).userId,
          BigInt(uploadId),
          variant,
          hash,
        );
        reply
          .header('content-type', found.variant.mime)
          .header('content-length', String(found.variant.sizeBytes))
          .header('x-content-type-options', 'nosniff')
          .header('content-security-policy', "default-src 'none'; sandbox")
          .header('cache-control', 'private, no-store')
          .header('cross-origin-resource-policy', 'same-site');
        if (variant === 'download')
          reply.header('content-disposition', disposition(found.filename));
        return reply.send(storage.read(found.variant.storageKey));
      },
    );
  });
}
