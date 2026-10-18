import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { registerHealthRoutes } from './api/health-routes.ts';
import type { AppContext } from './context.ts';
import { createOutboxDispatcher } from './events/outbox.ts';
import { createEventSubscriber } from './gateway/event-bus.ts';
import { registerGateway } from './gateway/gateway-server.ts';
import { createSessionStore } from './gateway/session-store.ts';
import { registerAuthentication } from './http/authentication.ts';
import { registerErrorHandling } from './http/error-handler.ts';
import { registerOpenApi } from './http/openapi.ts';
import { type PermissionChecker, registerPermissions } from './http/permissions.ts';
import { registerRateLimiting } from './http/rate-limit.ts';
import { createAdminService } from './modules/admin/admin-service.ts';
import { registerAuthRoutes } from './modules/auth/auth-routes.ts';
import { createAuthService } from './modules/auth/auth-service.ts';
import { createCodeHasher } from './modules/auth/crypto/code-hasher.ts';
import { registerChannelsRoutes } from './modules/channels/channels-routes.ts';
import { registerGuildChannelsRoutes } from './modules/guilds/guild-channels-routes.ts';
import { createGuildPermissionsService } from './modules/guilds/guild-permissions.ts';
import { registerGuildsRoutes } from './modules/guilds/guilds-routes.ts';
import { createMediaQueue } from './modules/media/media-queue.ts';
import { registerMediaRoutes } from './modules/media/media-routes.ts';
import { registerMessagesRoutes } from './modules/messages/messages-routes.ts';
import { registerPresenceRoutes } from './modules/presence/presence-routes.ts';
import { registerRelationshipsRoutes } from './modules/relationships/relationships-routes.ts';
import { createUsersService } from './modules/users/users-service.ts';
import { createChatServices } from './services.ts';

export const VERSION = '0.2.0';

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
  readonly permissionChecker?: PermissionChecker;
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
    // Exactly one trusted hop (Caddy): request.ip is the address Caddy saw.
    trustProxy: env.TRUST_PROXY ? (_address: string, hop: number) => hop === 0 : false,
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandling(app);
  // The CORS plugin creates one synthetic route without exposing a config option. Annotate
  // exactly that registration, then close the window before any application routes are added.
  let registeringCors = true;
  app.addHook('onRoute', (route) => {
    if (!registeringCors || route.method !== 'OPTIONS' || route.url !== '*') return;
    route.config = {
      ...route.config,
      auth: 'public',
      rateLimit: [],
      permission: { scope: 'none', reason: 'Browser CORS preflight; no resource data' },
    };
  });
  const guildPermissions = createGuildPermissionsService();
  registerPermissions(
    app,
    options.permissionChecker ??
      (({ scope, resourceId, userId }) =>
        scope === 'guild'
          ? guildPermissions.guild(context.database.db, resourceId, userId)
          : guildPermissions.channel(context.database.db, resourceId, userId)),
  );
  // Bearer tokens only, no cookies: CORS is about which renderer origins may read responses.
  await app.register(cors, {
    origin: env.CORS_ORIGINS,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    allowedHeaders: ['authorization', 'content-type', 'idempotency-key', 'upload-offset'],
    credentials: false,
    maxAge: 600,
  });
  registeringCors = false;

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
    rateLimiter: context.rateLimiter,
    hashRecoveryCode: createCodeHasher(env.TOTP_ENCRYPTION_KEY),
    log: app.log,
  });

  registerRateLimiting(app, context.rateLimiter);
  registerAuthentication(app, {
    tokens: context.tokens,
    revocations: context.revocations,
    isInstanceAdmin: auth.isInstanceAdmin,
    isAuthSessionActive: auth.isSessionActive,
  });
  await registerOpenApi(app, VERSION);
  registerHealthRoutes(app, VERSION);
  registerAuthRoutes(app, auth);

  const mediaQueue = createMediaQueue(env.VALKEY_URL, env.MEDIA_QUEUE_PREFIX);
  app.addHook('onClose', () => mediaQueue.close());
  const services = createChatServices(context, { log: app.log, enqueueMedia: mediaQueue.enqueue });
  const { db, relationships, channels, messages, presence, typing, media, storage } = services;
  registerGuildsRoutes(app, db, services.guilds);
  registerGuildChannelsRoutes(app, db, services.guildChannels);
  registerRelationshipsRoutes(app, db, relationships);
  registerChannelsRoutes(app, db, channels, messages, typing);
  registerMessagesRoutes(app, db, messages, typing);
  registerPresenceRoutes(app, db, presence, typing);
  await registerMediaRoutes(app, media, storage);
  app.addHook('onReady', () => presence.start());
  app.addHook('onClose', async () => {
    await presence.close();
    await typing.close();
  });

  const dispatcher = createOutboxDispatcher({ db, events: context.events, log: app.log });
  app.addHook('onReady', () => dispatcher.start());
  app.addHook('onClose', () => dispatcher.close());

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
      isAuthSessionActive: auth.isSessionActive,
      log: app.log,
      rateLimiter: context.rateLimiter,
      trustProxy: env.TRUST_PROXY,
      lifecycle: {
        attached: (session) => presence.hooks.attached(session.userId, session.id),
        heartbeat: (session) => presence.hooks.heartbeat(session.userId, session.id),
        detached: (session) => {
          presence.hooks.detached(session.userId, session.id);
          typing
            .clearSession(session.userId, session.authSessionId)
            .catch((error: unknown) => app.log.warn({ err: error }, 'typing cleanup failed'));
        },
      },
    },
    context.gateway,
  );
  return app;
}
