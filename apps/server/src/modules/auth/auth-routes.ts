import {
  authTokensSchema,
  createInstanceInviteRequestSchema,
  currentUserSchema,
  emailTokenRequestSchema,
  forgotPasswordRequestSchema,
  instanceInviteSchema,
  loginRequestSchema,
  loginResponseSchema,
  loginTotpRequestSchema,
  refreshRequestSchema,
  registerRequestSchema,
  resetPasswordRequestSchema,
  sessionSchema,
  snowflakeSchema,
  totpDisableRequestSchema,
  totpEnableRequestSchema,
  totpEnableResponseSchema,
  totpSetupRequestSchema,
  totpSetupResponseSchema,
} from '@silvercord/protocol';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireAuth } from '../../http/authentication.ts';
import { perBodyField, perIp, perUser } from '../../http/rate-limit.ts';
import type { AuthService } from './auth-service.ts';

const PER_HOUR = 1 / 3600;
const PER_MINUTE = 1 / 60;
const noContent = { 204: z.null() };
const DEFAULT_USER_LIMIT = [perUser('user.default', { capacity: 60, refillPerSecond: 1 })];

function client(request: FastifyRequest) {
  return {
    userAgent: request.headers['user-agent']?.slice(0, 512) ?? null,
    ip: request.ip,
  };
}

/** `/api/v1/auth/*`, `/api/v1/users/@me` and `/api/v1/admin/invites` (docs/spec/auth.md). */
export function registerAuthRoutes(app: FastifyInstance, auth: AuthService): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const tags = ['auth'];

  r.post(
    '/api/v1/auth/register',
    {
      schema: { tags, body: registerRequestSchema, response: { 201: authTokensSchema } },
      config: {
        auth: 'public',
        rateLimit: [perIp('auth.register', { capacity: 5, refillPerSecond: 5 * PER_HOUR })],
      },
    },
    async (request, reply) => {
      const { deviceName, ...input } = request.body;
      return reply.code(201).send(await auth.register(input, { deviceName, ...client(request) }));
    },
  );

  r.post(
    '/api/v1/auth/login',
    {
      schema: { tags, body: loginRequestSchema, response: { 200: loginResponseSchema } },
      config: {
        auth: 'public',
        rateLimit: [
          perIp('auth.login', { capacity: 10, refillPerSecond: 10 * PER_MINUTE }),
          perBodyField(
            'auth.login.account',
            { capacity: 5, refillPerSecond: 5 * PER_MINUTE },
            'login',
          ),
        ],
      },
    },
    async (request) => {
      const { login, password, deviceName } = request.body;
      return auth.login(login, password, { deviceName, ...client(request) });
    },
  );

  r.post(
    '/api/v1/auth/login/totp',
    {
      schema: { tags, body: loginTotpRequestSchema, response: { 200: authTokensSchema } },
      config: {
        auth: 'public',
        rateLimit: [
          perIp('auth.totp', { capacity: 5, refillPerSecond: 5 * PER_MINUTE }),
          perBodyField('auth.totp.ticket', { capacity: 5, refillPerSecond: PER_HOUR }, 'ticket'),
        ],
      },
    },
    async (request) => {
      const { ticket, ...factor } = request.body;
      return auth.loginWithSecondFactor(ticket, factor, client(request));
    },
  );

  r.post(
    '/api/v1/auth/refresh',
    {
      schema: { tags, body: refreshRequestSchema, response: { 200: authTokensSchema } },
      config: {
        auth: 'public',
        rateLimit: [perIp('auth.refresh', { capacity: 30, refillPerSecond: 30 * PER_MINUTE })],
      },
    },
    async (request) => auth.refresh(request.body.refreshToken),
  );

  r.post(
    '/api/v1/auth/logout',
    {
      schema: { tags, response: noContent },
      config: { auth: 'user', rateLimit: DEFAULT_USER_LIMIT },
    },
    async (request, reply) => {
      const { userId, sessionId } = requireAuth(request);
      await auth.revokeSession(userId, sessionId, 'logout');
      return reply.code(204).send(null);
    },
  );

  r.get(
    '/api/v1/auth/sessions',
    {
      schema: { tags, response: { 200: z.array(sessionSchema) } },
      config: { auth: 'user', rateLimit: DEFAULT_USER_LIMIT },
    },
    async (request) => {
      const { userId, sessionId } = requireAuth(request);
      return auth.listSessions(userId, sessionId);
    },
  );

  r.delete(
    '/api/v1/auth/sessions/:sessionId',
    {
      schema: { tags, params: z.object({ sessionId: snowflakeSchema }), response: noContent },
      config: { auth: 'user', rateLimit: DEFAULT_USER_LIMIT },
    },
    async (request, reply) => {
      const { userId } = requireAuth(request);
      await auth.revokeSession(userId, BigInt(request.params.sessionId), 'user_revoked');
      return reply.code(204).send(null);
    },
  );

  r.post(
    '/api/v1/auth/sessions/revoke-others',
    {
      schema: { tags, response: noContent },
      config: { auth: 'user', rateLimit: DEFAULT_USER_LIMIT },
    },
    async (request, reply) => {
      const { userId, sessionId } = requireAuth(request);
      await auth.revokeOtherSessions(userId, sessionId);
      return reply.code(204).send(null);
    },
  );

  r.post(
    '/api/v1/auth/email/verify',
    {
      schema: { tags, body: emailTokenRequestSchema, response: noContent },
      config: {
        auth: 'public',
        rateLimit: [perIp('auth.email.verify', { capacity: 10, refillPerSecond: 10 * PER_MINUTE })],
      },
    },
    async (request, reply) => {
      await auth.verifyEmail(request.body.token);
      return reply.code(204).send(null);
    },
  );

  r.post(
    '/api/v1/auth/email/resend',
    {
      schema: { tags, response: noContent },
      config: {
        auth: 'user',
        rateLimit: [perUser('auth.email.resend', { capacity: 3, refillPerSecond: 3 * PER_HOUR })],
      },
    },
    async (request, reply) => {
      await auth.resendVerification(requireAuth(request).userId);
      return reply.code(204).send(null);
    },
  );

  r.post(
    '/api/v1/auth/password/forgot',
    {
      schema: { tags, body: forgotPasswordRequestSchema, response: { 202: z.null() } },
      config: {
        auth: 'public',
        rateLimit: [
          perIp('auth.forgot', { capacity: 3, refillPerSecond: 3 * PER_HOUR }),
          perBodyField(
            'auth.forgot.email',
            { capacity: 3, refillPerSecond: 3 * PER_HOUR },
            'email',
          ),
        ],
      },
    },
    async (request, reply) => {
      await auth.forgotPassword(request.body.email);
      return reply.code(202).send(null);
    },
  );

  r.post(
    '/api/v1/auth/password/reset',
    {
      schema: { tags, body: resetPasswordRequestSchema, response: noContent },
      config: {
        auth: 'public',
        rateLimit: [perIp('auth.reset', { capacity: 10, refillPerSecond: 10 * PER_HOUR })],
      },
    },
    async (request, reply) => {
      await auth.resetPassword(request.body.token, request.body.password);
      return reply.code(204).send(null);
    },
  );

  const totpLimit = (name: string, perHour: number) => [
    perUser(`auth.totp.${name}`, { capacity: perHour, refillPerSecond: perHour * PER_HOUR }),
  ];

  r.post(
    '/api/v1/auth/totp/setup',
    {
      schema: { tags, body: totpSetupRequestSchema, response: { 200: totpSetupResponseSchema } },
      config: { auth: 'user', rateLimit: totpLimit('setup', 5) },
    },
    async (request) => auth.setupTotp(requireAuth(request).userId, request.body.password),
  );

  r.post(
    '/api/v1/auth/totp/enable',
    {
      schema: { tags, body: totpEnableRequestSchema, response: { 200: totpEnableResponseSchema } },
      config: { auth: 'user', rateLimit: totpLimit('enable', 10) },
    },
    async (request) => auth.enableTotp(requireAuth(request).userId, request.body.code),
  );

  r.post(
    '/api/v1/auth/totp/disable',
    {
      schema: { tags, body: totpDisableRequestSchema, response: noContent },
      config: { auth: 'user', rateLimit: totpLimit('disable', 10) },
    },
    async (request, reply) => {
      await auth.disableTotp(requireAuth(request).userId, request.body.password, request.body.code);
      return reply.code(204).send(null);
    },
  );

  r.get(
    '/api/v1/users/@me',
    {
      schema: { tags: ['users'], response: { 200: currentUserSchema } },
      config: { auth: 'user', rateLimit: DEFAULT_USER_LIMIT },
    },
    async (request) => auth.me(requireAuth(request).userId),
  );

  r.post(
    '/api/v1/admin/invites',
    {
      schema: {
        tags: ['admin'],
        body: createInstanceInviteRequestSchema,
        response: { 201: instanceInviteSchema },
      },
      config: {
        auth: 'instance-admin',
        rateLimit: [perUser('admin.invites', { capacity: 30, refillPerSecond: 30 * PER_HOUR })],
      },
    },
    async (request, reply) => {
      const { maxUses, expiresInHours } = request.body;
      return reply
        .code(201)
        .send(
          await auth.createInstanceInvite(requireAuth(request).userId, maxUses, expiresInHours),
        );
    },
  );
}
