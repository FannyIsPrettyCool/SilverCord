import { and, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import type { Executor } from '../../db/executor.ts';
import { emailTokens, recoveryCodes, refreshTokens, sessions, userTotp } from './auth-schema.ts';

export type SessionRow = typeof sessions.$inferSelect;
export type RevokeReason = NonNullable<SessionRow['revokedReason']>;
export type EmailTokenPurpose = (typeof emailTokens.$inferSelect)['purpose'];

export interface NewSession {
  readonly id: bigint;
  readonly userId: bigint;
  readonly deviceName: string;
  readonly userAgent: string | null;
  readonly ip: string | null;
}

/** Auth module persistence. Only this module reads or writes these tables. */
export const authRepository = {
  async insertSession(ex: Executor, session: NewSession): Promise<SessionRow> {
    const [row] = await ex.insert(sessions).values(session).returning();
    if (!row) throw new Error('insert returned no row');
    return row;
  },

  async hasSeenDevice(ex: Executor, userId: bigint, deviceName: string, userAgent: string | null) {
    const [row] = await ex
      .select({ id: sessions.id })
      .from(sessions)
      .where(
        and(
          eq(sessions.userId, userId),
          eq(sessions.deviceName, deviceName),
          userAgent === null ? isNull(sessions.userAgent) : eq(sessions.userAgent, userAgent),
        ),
      )
      .limit(1);
    return row !== undefined;
  },

  async listActiveSessions(ex: Executor, userId: bigint): Promise<SessionRow[]> {
    return ex
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
      .orderBy(desc(sessions.lastUsedAt));
  },

  /** Revokes active sessions matching the filter and returns their ids. */
  async revokeSessions(
    ex: Executor,
    filter: { userId: bigint; sessionId?: bigint; exceptSessionId?: bigint },
    reason: RevokeReason,
  ): Promise<bigint[]> {
    const rows = await ex
      .update(sessions)
      .set({ revokedAt: sql`now()`, revokedReason: reason })
      .where(
        and(
          eq(sessions.userId, filter.userId),
          isNull(sessions.revokedAt),
          filter.sessionId === undefined ? undefined : eq(sessions.id, filter.sessionId),
          filter.exceptSessionId === undefined
            ? undefined
            : ne(sessions.id, filter.exceptSessionId),
        ),
      )
      .returning({ id: sessions.id });
    return rows.map((row) => row.id);
  },

  async touchSession(ex: Executor, sessionId: bigint): Promise<void> {
    await ex.update(sessions).set({ lastUsedAt: sql`now()` }).where(eq(sessions.id, sessionId));
  },

  async insertRefreshToken(
    ex: Executor,
    token: { id: bigint; sessionId: bigint; tokenHash: Buffer; expiresAt: Date },
  ): Promise<void> {
    await ex.insert(refreshTokens).values(token);
  },

  /** Locks the token row and returns it with its session, for rotation. */
  async lockRefreshToken(ex: Executor, tokenHash: Buffer) {
    const [row] = await ex
      .select({
        id: refreshTokens.id,
        usedAt: refreshTokens.usedAt,
        expiresAt: refreshTokens.expiresAt,
        sessionId: sessions.id,
        userId: sessions.userId,
        sessionRevokedAt: sessions.revokedAt,
      })
      .from(refreshTokens)
      .innerJoin(sessions, eq(sessions.id, refreshTokens.sessionId))
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .for('update', { of: refreshTokens })
      .limit(1);
    return row;
  },

  async markRefreshTokenUsed(ex: Executor, id: bigint): Promise<void> {
    await ex.update(refreshTokens).set({ usedAt: sql`now()` }).where(eq(refreshTokens.id, id));
  },

  async replaceEmailToken(
    ex: Executor,
    token: {
      id: bigint;
      userId: bigint;
      purpose: EmailTokenPurpose;
      tokenHash: Buffer;
      expiresAt: Date;
    },
  ): Promise<void> {
    // Only the latest link of each kind stays valid.
    await ex
      .update(emailTokens)
      .set({ usedAt: sql`now()` })
      .where(
        and(
          eq(emailTokens.userId, token.userId),
          eq(emailTokens.purpose, token.purpose),
          isNull(emailTokens.usedAt),
        ),
      );
    await ex.insert(emailTokens).values(token);
  },

  /** Marks a valid, unused, unexpired token used and returns its user id. */
  async consumeEmailToken(
    ex: Executor,
    tokenHash: Buffer,
    purpose: EmailTokenPurpose,
  ): Promise<bigint | undefined> {
    const [row] = await ex
      .update(emailTokens)
      .set({ usedAt: sql`now()` })
      .where(
        and(
          eq(emailTokens.tokenHash, tokenHash),
          eq(emailTokens.purpose, purpose),
          isNull(emailTokens.usedAt),
          sql`${emailTokens.expiresAt} > now()`,
        ),
      )
      .returning({ userId: emailTokens.userId });
    return row?.userId;
  },

  async findTotp(ex: Executor, userId: bigint) {
    const [row] = await ex.select().from(userTotp).where(eq(userTotp.userId, userId)).limit(1);
    return row;
  },

  async upsertPendingTotp(ex: Executor, userId: bigint, secretEncrypted: Buffer): Promise<void> {
    await ex
      .insert(userTotp)
      .values({ userId, secretEncrypted })
      .onConflictDoUpdate({
        target: userTotp.userId,
        set: { secretEncrypted, createdAt: sql`now()` },
        setWhere: isNull(userTotp.confirmedAt),
      });
  },

  async confirmTotp(ex: Executor, userId: bigint): Promise<void> {
    await ex.update(userTotp).set({ confirmedAt: sql`now()` }).where(eq(userTotp.userId, userId));
  },

  async deleteTotp(ex: Executor, userId: bigint): Promise<void> {
    await ex.delete(userTotp).where(eq(userTotp.userId, userId));
    await ex.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
  },

  async replaceRecoveryCodes(
    ex: Executor,
    userId: bigint,
    codes: readonly { id: bigint; codeHash: Buffer }[],
  ): Promise<void> {
    await ex.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
    await ex.insert(recoveryCodes).values(codes.map((code) => ({ ...code, userId })));
  },

  async consumeRecoveryCode(ex: Executor, userId: bigint, codeHash: Buffer): Promise<boolean> {
    const rows = await ex
      .update(recoveryCodes)
      .set({ usedAt: sql`now()` })
      .where(
        and(
          eq(recoveryCodes.userId, userId),
          eq(recoveryCodes.codeHash, codeHash),
          isNull(recoveryCodes.usedAt),
        ),
      )
      .returning({ id: recoveryCodes.id });
    return rows.length === 1;
  },
};
