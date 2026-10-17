import type {
  AuthTokens,
  CurrentUser,
  InstanceInvite,
  Locale,
  LoginResponse,
  Session,
} from '@silvercord/protocol';
import { sql } from 'drizzle-orm';
import type { Database } from '../../db/client.ts';
import { type Executor, uniqueViolation } from '../../db/executor.ts';
import { channels, type EventPublisher } from '../../gateway/event-bus.ts';
import { AppError } from '../../http/app-error.ts';
import type { Mailer } from '../../infra/mailer.ts';
import type { RateLimiter } from '../../infra/rate-limiter.ts';
import type { Valkey } from '../../infra/valkey.ts';
import type { AdminService } from '../admin/admin-service.ts';
import type { UserRow } from '../users/users-schema.ts';
import type { UsersService } from '../users/users-service.ts';
import { authRepository as repo, type SessionRow } from './auth-repository.ts';
import type { TokenIssuer } from './crypto/access-tokens.ts';
import { createOpaqueToken, hashOpaqueToken } from './crypto/opaque-token.ts';
import { burnPasswordCheck, hashPassword, verifyPassword } from './crypto/password-hasher.ts';
import type { SecretBox } from './crypto/secret-box.ts';
import { appLink, buildEmail } from './emails.ts';
import type { SessionRevocations } from './session-revocations.ts';
import { generateRecoveryCodes, generateTotpSecret, verifyTotp } from './totp.ts';

const REFRESH_TTL_MS = 30 * 24 * 3600 * 1000;
const VERIFY_EMAIL_TTL_MS = 48 * 3600 * 1000;
const RESET_PASSWORD_TTL_MS = 30 * 60 * 1000;
/** 10 second-factor attempts per account per hour, across all tickets and IPs. */
const TOTP_ACCOUNT_POLICY = { capacity: 10, refillPerSecond: 10 / 3600 } as const;
/** Serializes registrations so exactly one "first user" becomes instance admin. */
const REGISTRATION_LOCK_KEY = 0x5c_0001;

export interface ClientInfo {
  readonly deviceName: string;
  readonly userAgent: string | null;
  readonly ip: string | null;
}

export interface RegisterInput {
  readonly email: string;
  readonly username: string;
  readonly password: string;
  readonly displayName?: string | undefined;
  readonly inviteCode?: string | undefined;
  readonly locale: Locale;
}

export interface AuthServiceDependencies {
  readonly db: Database;
  readonly valkey: Valkey;
  readonly nextId: () => bigint;
  readonly tokens: TokenIssuer;
  readonly revocations: SessionRevocations;
  readonly secretBox: SecretBox;
  readonly mailer: Mailer;
  readonly users: UsersService;
  readonly admin: AdminService;
  readonly events: EventPublisher;
  readonly rateLimiter: RateLimiter;
  /** Peppered hash for recovery codes (see crypto/code-hasher.ts). */
  readonly hashRecoveryCode: (code: string) => Buffer;
  readonly log: { warn(object: object, message: string): void };
}

export type AuthService = ReturnType<typeof createAuthService>;

export function createAuthService(deps: AuthServiceDependencies) {
  const { db, users, admin } = deps;

  /** Mail failures must not fail the request that triggered them; they are logged. */
  function sendMail(message: Parameters<Mailer['send']>[0]) {
    deps.mailer.send(message).catch((error: unknown) => {
      deps.log.warn({ err: error, subject: message.subject }, 'email delivery failed');
    });
  }

  async function mfaEnabled(ex: Executor, userId: bigint): Promise<boolean> {
    return (await repo.findTotp(ex, userId))?.confirmedAt != null;
  }

  async function currentUser(ex: Executor, row: UserRow): Promise<CurrentUser> {
    return users.toCurrentUser(row, await mfaEnabled(ex, row.id));
  }

  async function issueRefreshToken(ex: Executor, sessionId: bigint): Promise<string> {
    const { token, hash } = createOpaqueToken('scr_');
    await repo.insertRefreshToken(ex, {
      id: deps.nextId(),
      sessionId,
      tokenHash: hash,
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    });
    return token;
  }

  async function tokensFor(ex: Executor, user: UserRow, sessionId: bigint, refreshToken: string) {
    const access = await deps.tokens.issueAccessToken({ userId: user.id, sessionId });
    return {
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt.toISOString(),
      refreshToken,
      user: await currentUser(ex, user),
    } satisfies AuthTokens;
  }

  async function startSession(
    ex: Executor,
    user: UserRow,
    client: ClientInfo,
    alertNewDevice: boolean,
  ) {
    const seen =
      alertNewDevice &&
      (await repo.hasSeenDevice(ex, user.id, client.deviceName, client.userAgent, client.ip));
    const session = await repo.insertSession(ex, { id: deps.nextId(), userId: user.id, ...client });
    const refreshToken = await issueRefreshToken(ex, session.id);
    if (alertNewDevice && !seen) {
      sendMail(buildEmail('newDevice', user.locale, user.email, client.deviceName));
    }
    return tokensFor(ex, user, session.id, refreshToken);
  }

  async function sendVerification(ex: Executor, user: UserRow) {
    const { token, hash } = createOpaqueToken('sce_');
    await repo.replaceEmailToken(ex, {
      id: deps.nextId(),
      userId: user.id,
      purpose: 'verify_email',
      tokenHash: hash,
      expiresAt: new Date(Date.now() + VERIFY_EMAIL_TTL_MS),
    });
    return () =>
      sendMail(buildEmail('verify', user.locale, user.email, appLink('verify-email', token)));
  }

  /** Blocks the sessions' access tokens and closes their gateway sockets. */
  async function revoke(ids: readonly bigint[]) {
    await Promise.all(
      ids.flatMap((id) => [
        deps.revocations.revoke(id),
        deps.events.kick(channels.authSession(id)),
      ]),
    );
  }

  async function publishUserUpdate(userId: bigint) {
    const row = await users.findById(db, userId);
    if (row)
      await deps.events.dispatch(channels.user(userId), 'USER_UPDATE', await currentUser(db, row));
  }

  function requireUser(row: UserRow | undefined): UserRow {
    if (!row) throw new AppError('UNAUTHENTICATED', 'Account not found');
    return row;
  }

  return {
    async register(input: RegisterInput, client: ClientInfo): Promise<AuthTokens> {
      const passwordHash = await hashPassword(input.password);
      let afterCommit: (() => void) | undefined;
      try {
        const tokens = await db.transaction(async (tx) => {
          await tx.execute(sql`select pg_advisory_xact_lock(${REGISTRATION_LOCK_KEY})`);
          const isFirstUser = !(await users.hasAnyUser(tx));
          if (!isFirstUser) {
            const mode = await admin.registrationMode(tx);
            if (mode === 'closed')
              throw new AppError('REGISTRATION_CLOSED', 'Registration is closed');
            if (mode === 'invite_only') {
              if (!input.inviteCode) {
                throw new AppError('INVITE_REQUIRED', 'An invite is required', {
                  field: 'inviteCode',
                });
              }
              if (!(await admin.consumeInvite(tx, input.inviteCode))) {
                throw new AppError('INVITE_REQUIRED', 'Invite is invalid or expired', {
                  field: 'inviteCode',
                });
              }
            }
          }
          const user = await users.create(tx, {
            id: deps.nextId(),
            email: input.email,
            username: input.username,
            displayName: input.displayName ?? null,
            passwordHash,
            locale: input.locale,
            isInstanceAdmin: isFirstUser,
          });
          afterCommit = await sendVerification(tx, user);
          return startSession(tx, user, client, false);
        });
        afterCommit?.();
        return tokens;
      } catch (error) {
        const constraint = uniqueViolation(error);
        if (constraint === 'users_email_unique') {
          throw new AppError('CONFLICT', 'Email already registered', { field: 'email' });
        }
        if (constraint === 'users_username_unique') {
          throw new AppError('CONFLICT', 'Username taken', { field: 'username' });
        }
        throw error;
      }
    },

    async login(login: string, password: string, client: ClientInfo): Promise<LoginResponse> {
      const user = await users.findByLogin(db, login);
      if (!user) {
        await burnPasswordCheck(password);
        throw new AppError('INVALID_CREDENTIALS', 'Invalid login or password');
      }
      const check = await verifyPassword(user.passwordHash, password);
      if (!check.valid) throw new AppError('INVALID_CREDENTIALS', 'Invalid login or password');
      if (check.needsRehash) await users.setPasswordHash(db, user.id, await hashPassword(password));
      if (await mfaEnabled(db, user.id)) {
        return {
          mfaRequired: true,
          ticket: await deps.tokens.issueMfaTicket(user.id, client.deviceName),
        };
      }
      return db.transaction((tx) => startSession(tx, user, client, true));
    },

    async loginWithSecondFactor(
      ticket: string,
      factor: { code: string } | { recoveryCode: string },
      client: Omit<ClientInfo, 'deviceName'>,
    ): Promise<AuthTokens> {
      const { userId, deviceName } = await deps.tokens.verifyMfaTicket(ticket);
      // Per-account ceiling: fresh tickets per login must not multiply the guess budget.
      const budget = await deps.rateLimiter.consume(
        `auth.totp.account:${userId}`,
        TOTP_ACCOUNT_POLICY,
      );
      if (!budget.allowed) {
        throw new AppError('RATE_LIMITED', 'Too many attempts', {
          retryAfterSeconds: Math.max(1, Math.ceil(budget.retryAfterMs / 1000)),
        });
      }
      const user = requireUser(await users.findById(db, userId));
      const totp = await repo.findTotp(db, userId);
      if (!totp?.confirmedAt)
        throw new AppError('INVALID_TOTP', 'Two-factor authentication is off');
      const valid =
        'code' in factor
          ? await verifyTotp(
              deps.valkey,
              userId,
              deps.secretBox.open(totp.secretEncrypted).toString(),
              factor.code,
            )
          : await repo.consumeRecoveryCode(db, userId, deps.hashRecoveryCode(factor.recoveryCode));
      if (!valid) throw new AppError('INVALID_TOTP', 'Invalid code');
      return db.transaction((tx) => startSession(tx, user, { ...client, deviceName }, true));
    },

    async refresh(refreshToken: string): Promise<AuthTokens> {
      const outcome = await db.transaction(async (tx) => {
        const row = await repo.lockRefreshToken(tx, hashOpaqueToken(refreshToken));
        if (!row || row.sessionRevokedAt !== null) return { kind: 'invalid' as const };
        if (row.usedAt !== null) {
          // Reuse means the token leaked: kill the whole family (threat model T3).
          const ids = await repo.revokeSessions(
            tx,
            { userId: row.userId, sessionId: row.sessionId },
            'refresh_reuse',
          );
          return { kind: 'reused' as const, ids };
        }
        if (row.expiresAt.getTime() <= Date.now()) return { kind: 'expired' as const };
        await repo.markRefreshTokenUsed(tx, row.id);
        await repo.touchSession(tx, row.sessionId);
        const user = requireUser(await users.findById(tx, row.userId));
        const next = await issueRefreshToken(tx, row.sessionId);
        return { kind: 'ok' as const, tokens: await tokensFor(tx, user, row.sessionId, next) };
      });
      switch (outcome.kind) {
        case 'ok':
          return outcome.tokens;
        case 'reused':
          await revoke(outcome.ids);
          throw new AppError('TOKEN_REUSED', 'Refresh token reuse detected; session revoked');
        case 'expired':
          throw new AppError('TOKEN_EXPIRED', 'Refresh token expired');
        case 'invalid':
          throw new AppError('TOKEN_INVALID', 'Invalid refresh token');
      }
    },

    async me(userId: bigint): Promise<CurrentUser> {
      return currentUser(db, requireUser(await users.findById(db, userId)));
    },

    async listSessions(userId: bigint, currentSessionId: bigint): Promise<Session[]> {
      const rows = await repo.listActiveSessions(db, userId);
      return rows.map((row: SessionRow) => ({
        id: row.id.toString(),
        deviceName: row.deviceName,
        userAgent: row.userAgent,
        createdAt: row.createdAt.toISOString(),
        lastUsedAt: row.lastUsedAt.toISOString(),
        current: row.id === currentSessionId,
      }));
    },

    async revokeSession(userId: bigint, sessionId: bigint, reason: 'logout' | 'user_revoked') {
      const ids = await repo.revokeSessions(db, { userId, sessionId }, reason);
      if (ids.length === 0) throw new AppError('NOT_FOUND', 'Session not found');
      await revoke(ids);
    },

    async revokeOtherSessions(userId: bigint, currentSessionId: bigint) {
      await revoke(
        await repo.revokeSessions(
          db,
          { userId, exceptSessionId: currentSessionId },
          'user_revoked',
        ),
      );
    },

    async verifyEmail(token: string) {
      const userId = await repo.consumeEmailToken(db, hashOpaqueToken(token), 'verify_email');
      if (userId === undefined) throw new AppError('TOKEN_INVALID', 'Invalid or expired link');
      await users.markEmailVerified(db, userId);
      await publishUserUpdate(userId);
    },

    async resendVerification(userId: bigint) {
      const user = requireUser(await users.findById(db, userId));
      if (user.emailVerifiedAt !== null) return;
      (await sendVerification(db, user))();
    },

    /** Always succeeds from the caller's view (threat model T2). */
    async forgotPassword(email: string) {
      const user = await users.findByEmail(db, email);
      if (!user) return;
      const { token, hash } = createOpaqueToken('sce_');
      await repo.replaceEmailToken(db, {
        id: deps.nextId(),
        userId: user.id,
        purpose: 'reset_password',
        tokenHash: hash,
        expiresAt: new Date(Date.now() + RESET_PASSWORD_TTL_MS),
      });
      sendMail(buildEmail('reset', user.locale, user.email, appLink('reset-password', token)));
    },

    async resetPassword(token: string, password: string) {
      const passwordHash = await hashPassword(password);
      const ids = await db.transaction(async (tx) => {
        const userId = await repo.consumeEmailToken(tx, hashOpaqueToken(token), 'reset_password');
        if (userId === undefined) throw new AppError('TOKEN_INVALID', 'Invalid or expired link');
        await users.setPasswordHash(tx, userId, passwordHash);
        // Receiving the reset email proves control of the address.
        await users.markEmailVerified(tx, userId);
        return repo.revokeSessions(tx, { userId }, 'password_reset');
      });
      await revoke(ids);
    },

    async setupTotp(userId: bigint, password: string) {
      const user = requireUser(await users.findById(db, userId));
      if (!(await verifyPassword(user.passwordHash, password)).valid) {
        throw new AppError('INVALID_CREDENTIALS', 'Invalid password');
      }
      if (await mfaEnabled(db, userId))
        throw new AppError('CONFLICT', 'Two-factor authentication is already on');
      const { secretBase32, otpauthUri } = generateTotpSecret(user.username);
      await repo.upsertPendingTotp(db, userId, deps.secretBox.seal(Buffer.from(secretBase32)));
      return { secret: secretBase32, otpauthUri };
    },

    async enableTotp(userId: bigint, code: string) {
      const totp = await repo.findTotp(db, userId);
      if (!totp) throw new AppError('NOT_FOUND', 'Start two-factor setup first');
      if (totp.confirmedAt)
        throw new AppError('CONFLICT', 'Two-factor authentication is already on');
      const secret = deps.secretBox.open(totp.secretEncrypted).toString();
      if (!(await verifyTotp(deps.valkey, userId, secret, code)))
        throw new AppError('INVALID_TOTP', 'Invalid code');
      const codes = generateRecoveryCodes();
      await db.transaction(async (tx) => {
        await repo.confirmTotp(tx, userId);
        await repo.replaceRecoveryCodes(
          tx,
          userId,
          codes.map((plain) => ({
            id: deps.nextId(),
            codeHash: deps.hashRecoveryCode(plain.replace('-', '')),
          })),
        );
      });
      await publishUserUpdate(userId);
      const owner = await users.findById(db, userId);
      if (owner) sendMail(buildEmail('mfaOn', owner.locale, owner.email, ''));
      return { recoveryCodes: codes };
    },

    async disableTotp(userId: bigint, password: string, code: string) {
      const user = requireUser(await users.findById(db, userId));
      if (!(await verifyPassword(user.passwordHash, password)).valid) {
        throw new AppError('INVALID_CREDENTIALS', 'Invalid password');
      }
      const totp = await repo.findTotp(db, userId);
      if (!totp?.confirmedAt) throw new AppError('NOT_FOUND', 'Two-factor authentication is off');
      const secret = deps.secretBox.open(totp.secretEncrypted).toString();
      if (!(await verifyTotp(deps.valkey, userId, secret, code)))
        throw new AppError('INVALID_TOTP', 'Invalid code');
      await repo.deleteTotp(db, userId);
      await publishUserUpdate(userId);
      sendMail(buildEmail('mfaOff', user.locale, user.email, ''));
    },

    async createInstanceInvite(
      userId: bigint,
      maxUses: number,
      expiresInHours: number,
    ): Promise<InstanceInvite> {
      return admin.createInvite(db, {
        id: deps.nextId(),
        createdBy: userId,
        maxUses,
        expiresInHours,
      });
    },

    async isSessionActive(sessionId: bigint): Promise<boolean> {
      return repo.isSessionActive(db, sessionId);
    },

    async isInstanceAdmin(userId: bigint): Promise<boolean> {
      return (await users.findById(db, userId))?.isInstanceAdmin === true;
    },
  };
}
