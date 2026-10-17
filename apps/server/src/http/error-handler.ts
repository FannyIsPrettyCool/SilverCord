import type { ErrorEnvelope } from '@silvercord/protocol';
import type { FastifyError, FastifyInstance } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod';
import { AppError } from './app-error.ts';

type Envelope = ErrorEnvelope['error'];

function envelope(error: Envelope): ErrorEnvelope {
  return { error };
}

function isFastifyError(error: unknown): error is FastifyError {
  return error instanceof Error && 'code' in error && typeof error.code === 'string';
}

/** Maps every thrown error onto the shared envelope (BRIEF §5.1); never leaks internals. */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) =>
    reply
      .code(404)
      .send(envelope({ code: 'NOT_FOUND', message: 'Route not found', requestId: request.id })),
  );

  app.setErrorHandler((error, request, reply) => {
    const requestId = request.id;

    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.code(400).send(
        envelope({
          code: 'VALIDATION_FAILED',
          message: 'Request validation failed',
          requestId,
          issues: error.validation.map((issue) => ({
            path: `${error.validationContext ?? ''}${issue.instancePath}`,
            message: issue.message ?? 'invalid',
          })),
        }),
      );
    }

    if (error instanceof AppError) {
      if (error.retryAfterSeconds !== undefined) {
        void reply.header('retry-after', String(error.retryAfterSeconds));
      }
      return reply.code(error.statusCode).send(
        envelope({
          code: error.code,
          message: error.message,
          requestId,
          ...(error.retryAfterSeconds === undefined
            ? {}
            : { retryAfterSeconds: error.retryAfterSeconds }),
          ...(error.field === undefined
            ? {}
            : { issues: [{ path: error.field, message: error.message }] }),
        }),
      );
    }

    if (isFastifyError(error) && error.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return reply
        .code(413)
        .send(envelope({ code: 'PAYLOAD_TOO_LARGE', message: 'Payload too large', requestId }));
    }

    if (
      isFastifyError(error) &&
      error.statusCode !== undefined &&
      error.statusCode >= 400 &&
      error.statusCode < 500
    ) {
      // Malformed JSON, unsupported media types and similar framework-level client errors.
      return reply
        .code(error.statusCode)
        .send(envelope({ code: 'VALIDATION_FAILED', message: 'Malformed request', requestId }));
    }

    if (isResponseSerializationError(error)) {
      request.log.error({ err: error, issues: error.cause.issues }, 'response failed its schema');
    } else {
      request.log.error({ err: error }, 'unhandled error');
    }
    return reply
      .code(500)
      .send(envelope({ code: 'INTERNAL', message: 'Internal server error', requestId }));
  });
}
