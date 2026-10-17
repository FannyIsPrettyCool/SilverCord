import { errorEnvelopeSchema } from '@silvercord/protocol';
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError } from './app-error.ts';
import { registerErrorHandling } from './error-handler.ts';

describe('error handler', () => {
  const app = Fastify({ logger: false, bodyLimit: 64 });

  beforeAll(async () => {
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    registerErrorHandling(app);
    const typed = app.withTypeProvider<ZodTypeProvider>();
    typed.post('/echo', { schema: { body: z.object({ name: z.string().min(2) }) } }, (request) => ({
      name: request.body.name,
    }));
    typed.get('/limited', () => {
      throw new AppError('RATE_LIMITED', 'Slow down', { retryAfterSeconds: 7 });
    });
    typed.get('/boom', () => {
      throw new Error('database password is hunter2');
    });
    typed.get(
      '/bad-response',
      { schema: { response: { 200: z.object({ ok: z.literal(true) }) } } },
      () => ({ ok: false }) as unknown as { ok: true },
    );
    await app.ready();
  });
  afterAll(() => app.close());

  async function call(method: 'GET' | 'POST', url: string, payload?: Record<string, unknown>) {
    const response = await app.inject({
      method,
      url,
      ...(payload === undefined ? {} : { payload }),
    });
    return {
      status: response.statusCode,
      headers: response.headers,
      body: errorEnvelopeSchema.parse(response.json()),
    };
  }

  it('maps schema failures to VALIDATION_FAILED with issues', async () => {
    const { status, body } = await call('POST', '/echo', { name: 'x' });
    expect(status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.issues?.[0]?.path).toBe('body/name');
  });

  it('maps AppError with retry-after', async () => {
    const { status, headers, body } = await call('GET', '/limited');
    expect(status).toBe(429);
    expect(headers['retry-after']).toBe('7');
    expect(body.error).toMatchObject({ code: 'RATE_LIMITED', retryAfterSeconds: 7 });
  });

  it('hides internals of unexpected errors', async () => {
    const { status, body } = await call('GET', '/boom');
    expect(status).toBe(500);
    expect(body.error.message).toBe('Internal server error');
    expect(JSON.stringify(body)).not.toContain('hunter2');
  });

  it('treats response schema violations as internal errors', async () => {
    expect((await call('GET', '/bad-response')).status).toBe(500);
  });

  it('handles unknown routes, oversize and malformed bodies', async () => {
    expect((await call('GET', '/nope')).body.error.code).toBe('NOT_FOUND');
    expect((await call('POST', '/echo', { name: 'x'.repeat(100) })).body.error.code).toBe(
      'PAYLOAD_TOO_LARGE',
    );
    const malformed = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{nope',
    });
    expect(malformed.statusCode).toBe(400);
    expect(errorEnvelopeSchema.parse(malformed.json()).error.code).toBe('VALIDATION_FAILED');
  });
});
