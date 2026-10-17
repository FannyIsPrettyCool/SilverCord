import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { registerHealthRoutes } from './api/health-routes.ts';
import type { AppContext } from './context.ts';
import { createEventSubscriber } from './gateway/event-bus.ts';
import { registerGateway } from './gateway/gateway-server.ts';
import { createSessionStore } from './gateway/session-store.ts';
import { registerAuthentication } from './http/authentication.ts';
import { registerErrorHandling } from './http/error-handler.ts';
import { registerOpenApi } from './http/openapi.ts';
import { registerRateLimiting } from './http/rate-limit.ts';
import { createAdminService } from './modules/admin/admin-service.ts';
import { registerAuthRoutes } from './modules/auth/auth-routes.ts';
import { createAuthService } from './modules/auth/auth-service.ts';
import { createUsersService } from './modules/users/users-service.ts';

export const VERSION = '0.0.0';

const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  '*.password',
  '*.token',
  '*.refreshToken',
  '*.accessToken',
  '*.ticket',
  '*.totp',
  '*.code',
  '*.recoveryCode',
];

export interface BuildOptions {
  /** Log destination; defaults to stdout. Tests capture it to assert on redaction. */
  readonly logStream?: { write(line: string): void };
}

/** Builds the HTTP app without listening, so tests can use `app.inject`. */
export async function buildApp(
  context: AppContext,
  options: BuildOptions = {},
): Promise<FastifyInstance> {
  const { env } = context;
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
      ...(options.logStream ? { stream: options.logStream } : {}),
    },
    bodyLimit: 1_048_576,
    trustProxy: env.TRUST_PROXY,
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandling(app);

  const auth = createAuthService({
    db: context.database.db,
    valkey: context.valkey,
    nextId: context.nextId,
    tokens: context.tokens,
    revocations: context.revocations,
    secretBox: context.secretBox,
    mailer: context.mailer,
    users: createUsersService(),
    admin: createAdminService(),
    events: context.events,
    log: app.log,
  });

  registerRateLimiting(app, context.rateLimiter);
  registerAuthentication(app, {
    tokens: context.tokens,
    revocations: context.revocations,
    isInstanceAdmin: auth.isInstanceAdmin,
  });
  await registerOpenApi(app, VERSION);
  registerHealthRoutes(app, VERSION);
  registerAuthRoutes(app, auth);

  const subscriber = await createEventSubscriber(context.valkey);
  app.addHook('onClose', () => subscriber.close());
  registerGateway(
    app,
    {
      tokens: context.tokens,
      revocations: context.revocations,
      sessions: createSessionStore(context.valkey),
      subscriber,
      loadUser: auth.me,
      log: app.log,
    },
    context.gateway,
  );
  return app;
}
