import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { TokenIssuer } from '../modules/auth/crypto/access-tokens.ts';
import type { SessionRevocations } from '../modules/auth/session-revocations.ts';
import { AppError } from './app-error.ts';

export type AuthRequirement = 'public' | 'user' | 'instance-admin';

export interface RequestAuth {
  readonly userId: bigint;
  readonly sessionId: bigint;
}

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Required on every route; registration fails without it. */
    auth?: AuthRequirement;
  }
  interface FastifyRequest {
    auth: RequestAuth | null;
  }
}

export class MissingAuthDeclarationError extends Error {
  readonly code = 'MISSING_AUTH_DECLARATION';
}

export interface AuthenticationDependencies {
  readonly tokens: TokenIssuer;
  readonly revocations: SessionRevocations;
  readonly isAuthSessionActive: (sessionId: bigint) => Promise<boolean>;
  readonly isInstanceAdmin: (userId: bigint) => Promise<boolean>;
}

function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (header === undefined) return null;
  const match = /^Bearer ([\w.-]+)$/.exec(header);
  if (!match?.[1]) throw new AppError('TOKEN_INVALID', 'Malformed authorization header');
  return match[1];
}

/** Returns the authenticated caller or throws; use inside handlers of `user` routes. */
export function requireAuth(request: FastifyRequest): RequestAuth {
  if (request.auth === null) throw new AppError('UNAUTHENTICATED', 'Authentication required');
  return request.auth;
}

/**
 * Verifies bearer tokens and enforces each route's declared requirement. Registered before the
 * rate limiter's route rules so user-keyed limits see `request.auth`.
 */
export function registerAuthentication(
  app: FastifyInstance,
  deps: AuthenticationDependencies,
): void {
  app.decorateRequest('auth', null);

  app.addHook('onRoute', (route) => {
    if (route.config?.auth === undefined) {
      throw new MissingAuthDeclarationError(`${route.method} ${route.url} has no auth declaration`);
    }
  });

  app.addHook('onRequest', async (request) => {
    // Unknown paths answer 404 to everyone instead of leaking an auth requirement.
    if (request.is404) return;
    const requirement = request.routeOptions.config.auth ?? 'user';
    const token = bearerToken(request);
    if (token === null) {
      if (requirement !== 'public')
        throw new AppError('UNAUTHENTICATED', 'Authentication required');
      return;
    }
    const claims = await deps.tokens.verifyAccessToken(token);
    // Valkey markers accelerate rejections, but can be lost on an outage or failed write.
    // The database remains authoritative even after the cache recovers.
    if (
      (await deps.revocations.isRevoked(claims.sessionId)) ||
      !(await deps.isAuthSessionActive(claims.sessionId))
    ) {
      throw new AppError('TOKEN_INVALID', 'Session revoked');
    }
    request.auth = claims;
    if (requirement === 'instance-admin' && !(await deps.isInstanceAdmin(claims.userId))) {
      throw new AppError('FORBIDDEN', 'Instance admin required');
    }
  });
}
