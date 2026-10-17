import { sql } from 'drizzle-orm';
import { boolean, check, pgTable, text } from 'drizzle-orm/pg-core';
import { citext, snowflake, timestamptz } from '../../db/columns.ts';

export const users = pgTable(
  'users',
  {
    id: snowflake().primaryKey(),
    username: citext().notNull().unique(),
    displayName: text(),
    email: citext().notNull().unique(),
    emailVerifiedAt: timestamptz(),
    passwordHash: text().notNull(),
    isInstanceAdmin: boolean().notNull().default(false),
    locale: text({ enum: ['en', 'fr'] }).notNull(),
    ageConfirmedAt: timestamptz().notNull(),
    usernameChangedAt: timestamptz(),
    createdAt: timestamptz().notNull().default(sql`now()`),
    updatedAt: timestamptz().notNull().default(sql`now()`),
  },
  (table) => [check('users_locale_valid', sql`${table.locale} in ('en', 'fr')`)],
);

export type UserRow = typeof users.$inferSelect;
