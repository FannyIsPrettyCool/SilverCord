import { sql } from 'drizzle-orm';
import { check, index, inet, pgTable, text } from 'drizzle-orm/pg-core';
import { bytea, snowflake, timestamptz } from '../../db/columns.ts';
import { users } from '../users/users-schema.ts';

/** One session per login; its refresh tokens form one rotation family. */
export const sessions = pgTable(
  'sessions',
  {
    id: snowflake().primaryKey(),
    userId: snowflake()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceName: text().notNull(),
    userAgent: text(),
    // Retained 90 days at most (BRIEF §8.4); cleared by the cleanup job.
    ip: inet(),
    createdAt: timestamptz().notNull().default(sql`now()`),
    lastUsedAt: timestamptz().notNull().default(sql`now()`),
    revokedAt: timestamptz(),
    revokedReason: text({
      enum: ['logout', 'user_revoked', 'refresh_reuse', 'password_reset', 'admin'],
    }),
  },
  // Session list per user, filtered on active ones.
  (table) => [
    index('sessions_user_id_revoked_at_idx').on(table.userId, table.revokedAt),
    check(
      'sessions_revoked_reason_valid',
      sql`${table.revokedReason} in ('logout', 'user_revoked', 'refresh_reuse', 'password_reset', 'admin')`,
    ),
  ],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: snowflake().primaryKey(),
    sessionId: snowflake()
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    tokenHash: bytea().notNull().unique(),
    expiresAt: timestamptz().notNull(),
    usedAt: timestamptz(),
    createdAt: timestamptz().notNull().default(sql`now()`),
  },
  // FK lookups when a session is revoked or deleted.
  (table) => [index('refresh_tokens_session_id_idx').on(table.sessionId)],
);

export const emailTokens = pgTable(
  'email_tokens',
  {
    id: snowflake().primaryKey(),
    userId: snowflake()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: text({ enum: ['verify_email', 'reset_password'] }).notNull(),
    tokenHash: bytea().notNull().unique(),
    expiresAt: timestamptz().notNull(),
    usedAt: timestamptz(),
    createdAt: timestamptz().notNull().default(sql`now()`),
  },
  // Invalidate outstanding tokens of one purpose when a new one is issued.
  (table) => [
    index('email_tokens_user_id_purpose_idx').on(table.userId, table.purpose),
    check(
      'email_tokens_purpose_valid',
      sql`${table.purpose} in ('verify_email', 'reset_password')`,
    ),
  ],
);

export const userTotp = pgTable('user_totp', {
  userId: snowflake()
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  secretEncrypted: bytea().notNull(),
  confirmedAt: timestamptz(),
  createdAt: timestamptz().notNull().default(sql`now()`),
});

export const recoveryCodes = pgTable(
  'recovery_codes',
  {
    id: snowflake().primaryKey(),
    userId: snowflake()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeHash: bytea().notNull(),
    usedAt: timestamptz(),
  },
  (table) => [index('recovery_codes_user_id_idx').on(table.userId)],
);
