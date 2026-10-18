import { sql } from 'drizzle-orm';
import { check, pgTable, text } from 'drizzle-orm/pg-core';
import { snowflake, timestamptz } from '../../db/columns.ts';
import { users } from '../users/users-schema.ts';

/** Saved status choice only: no last-seen, IP or activity history (docs/spec/presence.md). */
export const presencePreferences = pgTable(
  'presence_preferences',
  {
    userId: snowflake()
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: text({ enum: ['online', 'idle', 'dnd', 'invisible'] })
      .notNull()
      .default('online'),
    updatedAt: timestamptz().notNull().default(sql`now()`),
  },
  (table) => [
    check(
      'presence_preferences_status_valid',
      sql`${table.status} in ('online', 'idle', 'dnd', 'invisible')`,
    ),
  ],
);
