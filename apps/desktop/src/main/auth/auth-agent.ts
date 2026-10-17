import { hostname } from 'node:os';
import {
  type AuthTokens,
  authTokensSchema,
  errorEnvelopeSchema,
  loginResponseSchema,
} from '@silvercord/protocol';
import { net } from 'electron';
import { z } from 'zod';
import type { LoginOutcome, RegisterInput, SessionSnapshot } from '../../shared/ipc-contract.ts';
import type { TokenStore } from './token-store.ts';

const SESSION_ENDING: ReadonlySet<string> = new Set([
  'TOKEN_INVALID',
  'TOKEN_EXPIRED',
  'TOKEN_REUSED',
  'UNAUTHENTICATED',
]);

/** Refresh this long before expiry so requests never race the deadline. */
const REFRESH_MARGIN_MS = 60_000;

export class ApiError extends Error {
  readonly code: string;
  readonly field: string | undefined;
  constructor(code: string, message: string, field?: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.field = field;
  }
}

export function deviceName(): string {
  const os =
    process.platform === 'win32'
      ? 'Windows'
      : process.platform === 'linux'
        ? 'Linux'
        : process.platform;
  return `${hostname().slice(0, 40)} · ${os}`;
}

/**
 * Holds the refresh token and MFA ticket in the main process and performs every token-bearing
 * auth call. Refreshes are serialized: two concurrent rotations with one token would trip the
 * server's reuse detection and revoke the session (docs/spec/auth.md).
 */
export function createAuthAgent(apiUrl: string, store: TokenStore) {
  let session: { tokens: AuthTokens } | null = null;
  let mfaTicket: string | null = null;
  let refreshing: Promise<SessionSnapshot> | null = null;
  /** Bumped on logout: results of requests started before it are discarded. */
  let generation = 0;

  async function call<S extends z.ZodType>(
    path: string,
    body: unknown,
    schema: S,
  ): Promise<z.infer<S>> {
    let response: Response;
    try {
      response = await net.fetch(`${apiUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      throw new ApiError('NETWORK', 'Server unreachable');
    }
    const json: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const envelope = errorEnvelopeSchema.safeParse(json);
      throw envelope.success
        ? new ApiError(
            envelope.data.error.code,
            envelope.data.error.message,
            envelope.data.error.issues?.[0]?.path,
          )
        : new ApiError('INTERNAL', `Unexpected response ${response.status}`);
    }
    return schema.parse(json);
  }

  async function adopt(tokens: AuthTokens, startedIn = generation): Promise<SessionSnapshot> {
    if (startedIn !== generation) throw new ApiError('UNAUTHENTICATED', 'Signed out');
    session = { tokens };
    mfaTicket = null;
    await store.save(tokens.refreshToken);
    return snapshot(tokens);
  }

  function snapshot(tokens: AuthTokens): SessionSnapshot {
    return {
      user: tokens.user,
      accessToken: tokens.accessToken,
      accessTokenExpiresAt: tokens.accessTokenExpiresAt,
      persistent: store.persistent,
    };
  }

  async function refreshWith(refreshToken: string): Promise<SessionSnapshot> {
    const startedIn = generation;
    try {
      return await adopt(
        await call('/api/v1/auth/refresh', { refreshToken }, authTokensSchema),
        startedIn,
      );
    } catch (error) {
      // Only a rejected token ends the session; 429s, 5xx and network trouble are retried later.
      if (error instanceof ApiError && SESSION_ENDING.has(error.code) && startedIn === generation) {
        session = null;
        await store.clear();
      }
      throw error;
    }
  }

  function refreshOnce(refreshToken: string): Promise<SessionSnapshot> {
    refreshing ??= refreshWith(refreshToken).finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  return {
    async restore(): Promise<SessionSnapshot | null> {
      const stored = session?.tokens.refreshToken ?? (await store.load());
      if (!stored) return null;
      try {
        return await refreshOnce(stored);
      } catch (error) {
        if (error instanceof ApiError && error.code === 'NETWORK') throw error;
        return null;
      }
    },

    async register(input: RegisterInput): Promise<SessionSnapshot> {
      return adopt(
        await call(
          '/api/v1/auth/register',
          { ...input, deviceName: deviceName() },
          authTokensSchema,
        ),
      );
    },

    async login(login: string, password: string): Promise<LoginOutcome> {
      const result = await call(
        '/api/v1/auth/login',
        { login, password, deviceName: deviceName() },
        loginResponseSchema,
      );
      if ('mfaRequired' in result) {
        mfaTicket = result.ticket;
        return { status: 'mfa-required' };
      }
      return { status: 'signed-in', session: await adopt(result) };
    },

    async loginSecondFactor(
      factor: { code: string } | { recoveryCode: string },
    ): Promise<SessionSnapshot> {
      if (!mfaTicket) throw new ApiError('TOKEN_INVALID', 'Sign in again');
      return adopt(
        await call('/api/v1/auth/login/totp', { ticket: mfaTicket, ...factor }, authTokensSchema),
      );
    },

    /** Current access token, refreshed first when it is about to expire. */
    async accessToken(): Promise<SessionSnapshot> {
      if (!session) throw new ApiError('UNAUTHENTICATED', 'Not signed in');
      const expiresAt = Date.parse(session.tokens.accessTokenExpiresAt);
      if (expiresAt - Date.now() > REFRESH_MARGIN_MS) return snapshot(session.tokens);
      return refreshOnce(session.tokens.refreshToken);
    },

    async logout(): Promise<void> {
      // A fresh access token, or the server-side session would outlive the "signed out" UI.
      const current = session ? await this.accessToken().catch(() => null) : null;
      generation += 1;
      session = null;
      mfaTicket = null;
      await store.clear();
      if (!current) return;
      await net
        .fetch(`${apiUrl}/api/v1/auth/logout`, {
          method: 'POST',
          headers: { authorization: `Bearer ${current.accessToken}` },
        })
        .catch(() => undefined);
    },

    /** Always "sent" from the user's view; the server answers 202 either way. */
    async forgotPassword(email: string): Promise<void> {
      await call('/api/v1/auth/password/forgot', { email }, z.null());
    },
  };
}

export type AuthAgent = ReturnType<typeof createAuthAgent>;
