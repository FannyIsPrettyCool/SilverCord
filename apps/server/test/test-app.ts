import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { inject } from 'vitest';
import { buildApp } from '../src/app.ts';
import { loadEnv } from '../src/config/env.ts';
import { type AppContext, closeAppContext, createAppContext } from '../src/context.ts';
import type { Mailer, MailMessage } from '../src/infra/mailer.ts';
import type { RateLimiter } from '../src/infra/rate-limiter.ts';
import { createValkey } from '../src/infra/valkey.ts';
import { createTestDatabase } from './database.ts';

export interface CapturingMailer extends Mailer {
  readonly sent: MailMessage[];
  /** Waits for the next message to `to` (mail is sent after the response). */
  next(to: string): Promise<MailMessage>;
}

function createCapturingMailer(): CapturingMailer {
  const sent: MailMessage[] = [];
  const waiters: { to: string; resolve: (message: MailMessage) => void }[] = [];
  return {
    sent,
    async send(message) {
      sent.push(message);
      const index = waiters.findIndex((waiter) => waiter.to === message.to);
      if (index >= 0) waiters.splice(index, 1)[0]?.resolve(message);
    },
    next(to) {
      return new Promise((resolve, reject) => {
        waiters.push({ to, resolve });
        setTimeout(() => reject(new Error(`no mail to ${to}`)), 5000);
      });
    },
  };
}

export interface TestApp {
  readonly app: FastifyInstance;
  readonly context: AppContext;
  readonly mailer: CapturingMailer;
  request(options: InjectOptions): Promise<LightMyRequestResponse>;
  close(): Promise<void>;
}

const unlimited: RateLimiter = {
  consume: async () => ({ allowed: true, remaining: Number.MAX_SAFE_INTEGER, retryAfterMs: 0 }),
};

/**
 * Full app on an isolated database and the shared Valkey container. Rate limits are off unless
 * `rateLimits: 'valkey'` (the real limiter) is requested by a rate-limit test.
 */
export async function createTestApp(
  options: { rateLimits?: 'off' | 'valkey' } = {},
): Promise<TestApp> {
  const database = await createTestDatabase();
  const valkey = createValkey(inject('valkeyUrl'));
  await valkey.connect();
  const mailer = createCapturingMailer();
  const env = loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'silent', DATABASE_URL: database.url });
  const context = await createAppContext(env, {
    database,
    valkey,
    mailer,
    ...(options.rateLimits === 'valkey' ? {} : { rateLimiter: unlimited }),
  });
  const app = await buildApp(context);
  await app.ready();
  return {
    app,
    context,
    mailer,
    request: (requestOptions) => app.inject(requestOptions),
    async close() {
      await app.close();
      await closeAppContext(context);
    },
  };
}
