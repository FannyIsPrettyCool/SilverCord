import { createSnowflakeGenerator } from '@silvercord/protocol';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { inject } from 'vitest';
import { buildApp } from '../src/app.ts';
import { loadEnv } from '../src/config/env.ts';
import { type AppContext, closeAppContext, createAppContext } from '../src/context.ts';
import type { GatewayOptions } from '../src/gateway/gateway-connection.ts';
import { DEFAULT_GATEWAY_OPTIONS } from '../src/gateway/gateway-server.ts';
import type { Mailer, MailMessage } from '../src/infra/mailer.ts';
import type { RateLimiter } from '../src/infra/rate-limiter.ts';
import { createValkey } from '../src/infra/valkey.ts';
import type { PresenceTimings } from '../src/modules/presence/presence-service.ts';
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
  options: {
    rateLimits?: 'off' | 'valkey';
    rateLimiter?: RateLimiter;
    logLines?: string[];
    gateway?: Partial<GatewayOptions>;
    presence?: PresenceTimings;
  } = {},
): Promise<TestApp> {
  const database = await createTestDatabase();
  const valkey = createValkey(inject('valkeyUrl'));
  await valkey.connect();
  const mailer = createCapturingMailer();
  // Isolated databases still share Valkey revocation/session keys. Separate snowflake workers
  // prevent same-millisecond ids in parallel suites from referring to unrelated accounts.
  const workerId = (await valkey.incr('test:snowflake-worker')) % 1024;
  const env = loadEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: options.logLines ? 'trace' : 'silent',
    DATABASE_URL: database.url,
  });
  const context = await createAppContext(env, {
    database,
    valkey,
    mailer,
    nextId: createSnowflakeGenerator({ workerId }),
    ...(options.rateLimiter
      ? { rateLimiter: options.rateLimiter }
      : options.rateLimits === 'valkey'
        ? {}
        : { rateLimiter: unlimited }),
    gateway: { ...DEFAULT_GATEWAY_OPTIONS, ...options.gateway },
    ...(options.presence ? { presence: options.presence } : {}),
  });
  const lines = options.logLines;
  const app = await buildApp(
    context,
    lines ? { logStream: { write: (line) => void lines.push(line) } } : {},
  );
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
