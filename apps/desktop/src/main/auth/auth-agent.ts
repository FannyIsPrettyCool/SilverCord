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
  /** A logout may finish this old rotation for revocation without adopting its result. */
  let refreshingTokens: Promise<AuthTokens> | null = null;
  /** Bumped on logout: results of requests started before it are discarded. */
  let generation = 0;
  /** A logout clear must finish after every older disk write. */
  let persisting: Promise<void> = Promise.resolve();

  function persist(task: () => Promise<void>): Promise<void> {
    const pending = persisting.then(task);
    persisting = pending.catch(() => undefined);
    return pending;
  }

  function requireGeneration(startedIn: number) {
    if (startedIn !== generation) throw new ApiError('UNAUTHENTICATED', 'Signed out');
  }

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

  async function adopt(tokens: AuthTokens, startedIn: number): Promise<SessionSnapshot> {
    requireGeneration(startedIn);
    session = { tokens };
    mfaTicket = null;
    await persist(() => store.save(tokens.refreshToken));
    requireGeneration(startedIn);
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

  async function refreshWith(
    issued: Promise<AuthTokens>,
    startedIn: number,
  ): Promise<SessionSnapshot> {
    try {
      return await adopt(await issued, startedIn);
    } catch (error) {
      // Only a rejected token ends the session; 429s, 5xx and network trouble are retried later.
      if (error instanceof ApiError && SESSION_ENDING.has(error.code) && startedIn === generation) {
        session = null;
        await persist(() => store.clear());
      }
      throw error;
    }
  }

  function refreshOnce(refreshToken: string, startedIn = generation): Promise<SessionSnapshot> {
    if (refreshing) return refreshing;
    const issued = call('/api/v1/auth/refresh', { refreshToken }, authTokensSchema);
    refreshingTokens = issued;
    const pending = refreshWith(issued, startedIn).finally(() => {
      // A completed old rotation must not detach a newer account's single-flight refresh.
      if (refreshing === pending) refreshing = null;
      if (refreshingTokens === issued) refreshingTokens = null;
    });
    refreshing = pending;
    return pending;
  }

  return {
    async restore(): Promise<SessionSnapshot | null> {
      const startedIn = generation;
      const stored = session?.tokens.refreshToken ?? (await store.load());
      if (!stored || startedIn !== generation) return null;
      try {
        return await refreshOnce(stored, startedIn);
      } catch (error) {
        if (error instanceof ApiError && error.code === 'NETWORK') throw error;
        return null;
      }
    },

    async register(input: RegisterInput): Promise<SessionSnapshot> {
      const startedIn = generation;
      return adopt(
        await call(
          '/api/v1/auth/register',
          { ...input, deviceName: deviceName() },
          authTokensSchema,
        ),
        startedIn,
      );
    },

    async login(login: string, password: string): Promise<LoginOutcome> {
      const startedIn = generation;
      mfaTicket = null;
      const result = await call(
        '/api/v1/auth/login',
        { login, password, deviceName: deviceName() },
        loginResponseSchema,
      );
      requireGeneration(startedIn);
      if ('mfaRequired' in result) {
        mfaTicket = result.ticket;
        return { status: 'mfa-required' };
      }
      return { status: 'signed-in', session: await adopt(result, startedIn) };
    },

    async loginSecondFactor(
      factor: { code: string } | { recoveryCode: string },
    ): Promise<SessionSnapshot> {
      if (!mfaTicket) throw new ApiError('TOKEN_INVALID', 'Sign in again');
      const startedIn = generation;
      return adopt(
        await call('/api/v1/auth/login/totp', { ticket: mfaTicket, ...factor }, authTokensSchema),
        startedIn,
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
      const old = session?.tokens;
      const pendingRotation = refreshingTokens;
      // End the old account before any network/storage await can let a new login begin.
      generation += 1;
      session = null;
      mfaTicket = null;
      refreshing = null;
      refreshingTokens = null;
      // Enqueue this clear now; any newer login saves after it in the persistence queue.
      await persist(() => store.clear());

      let accessToken = old?.accessToken;
      if (!old || Date.parse(old.accessTokenExpiresAt) - Date.now() <= REFRESH_MARGIN_MS) {
        // Rotation is only for the captured old session. Never adopt or save its tokens.
        const rotation =
          pendingRotation ??
          (old
            ? call('/api/v1/auth/refresh', { refreshToken: old.refreshToken }, authTokensSchema)
            : null);
        accessToken = rotation
          ? await rotation.then(
              (tokens) => tokens.accessToken,
              () => undefined,
            )
          : undefined;
      }
      if (!accessToken) return;
      await net
        .fetch(`${apiUrl}/api/v1/auth/logout`, {
          method: 'POST',
          headers: { authorization: `Bearer ${accessToken}` },
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
