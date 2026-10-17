import { createSnowflakeGenerator } from '@silvercord/protocol';
import type { Env } from './config/env.ts';
import { createDatabase, type DatabaseHandle } from './db/client.ts';
import { createEventPublisher, type EventPublisher } from './gateway/event-bus.ts';
import type { GatewayOptions } from './gateway/gateway-connection.ts';
import { DEFAULT_GATEWAY_OPTIONS } from './gateway/gateway-server.ts';
import { createSmtpMailer, type Mailer } from './infra/mailer.ts';
import { createRateLimiter, type RateLimiter } from './infra/rate-limiter.ts';
import { createValkey, type Valkey } from './infra/valkey.ts';
import { createTokenIssuer, type TokenIssuer } from './modules/auth/crypto/access-tokens.ts';
import { createSecretBox, type SecretBox } from './modules/auth/crypto/secret-box.ts';
import {
  createSessionRevocations,
  type SessionRevocations,
} from './modules/auth/session-revocations.ts';

/** Process-wide infrastructure, built once in `main.ts` (or per test file). */
export interface AppContext {
  readonly env: Env;
  readonly database: DatabaseHandle;
  readonly valkey: Valkey;
  readonly rateLimiter: RateLimiter;
  readonly mailer: Mailer;
  readonly nextId: () => bigint;
  readonly tokens: TokenIssuer;
  readonly revocations: SessionRevocations;
  readonly secretBox: SecretBox;
  readonly events: EventPublisher;
  readonly gateway: GatewayOptions;
}

export async function createAppContext(
  env: Env,
  overrides: Partial<AppContext> = {},
): Promise<AppContext> {
  const valkey = overrides.valkey ?? createValkey(env.VALKEY_URL);
  if (valkey.status === 'wait') await valkey.connect();
  return {
    env,
    database: overrides.database ?? createDatabase(env.DATABASE_URL),
    valkey,
    rateLimiter: overrides.rateLimiter ?? createRateLimiter(valkey),
    mailer: overrides.mailer ?? createSmtpMailer(env.SMTP_URL, env.MAIL_FROM),
    nextId: overrides.nextId ?? createSnowflakeGenerator({ workerId: env.WORKER_ID }),
    tokens: overrides.tokens ?? createTokenIssuer(env.JWT_SECRET),
    revocations: overrides.revocations ?? createSessionRevocations(valkey),
    secretBox: overrides.secretBox ?? createSecretBox(env.TOTP_ENCRYPTION_KEY),
    events: overrides.events ?? createEventPublisher(valkey),
    gateway: overrides.gateway ?? DEFAULT_GATEWAY_OPTIONS,
  };
}

export async function closeAppContext(context: AppContext): Promise<void> {
  await context.database.close();
  await context.valkey.quit();
}
