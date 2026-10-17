import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, smallint, text } from 'drizzle-orm/pg-core';
import { snowflake, timestamptz } from '../../db/columns.ts';
import { users } from '../users/users-schema.ts';

/** Single-row table of instance-wide settings. */
export const instanceSettings = pgTable(
  'instance_settings',
  {
    id: smallint().primaryKey().default(1),
    registrationMode: text({ enum: ['open', 'invite_only', 'closed'] })
      .notNull()
      .default('invite_only'),
    updatedAt: timestamptz().notNull().default(sql`now()`),
  },
  (table) => [
    check('instance_settings_single_row', sql`${table.id} = 1`),
    check(
      'instance_settings_registration_mode_valid',
      sql`${table.registrationMode} in ('open', 'invite_only', 'closed')`,
    ),
  ],
);

/** Registration invites (not guild invites). */
export const instanceInvites = pgTable(
  'instance_invites',
  {
    id: snowflake().primaryKey(),
    code: text().notNull().unique(),
    createdBy: snowflake()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    maxUses: integer().notNull(),
    uses: integer().notNull().default(0),
    expiresAt: timestamptz().notNull(),
    createdAt: timestamptz().notNull().default(sql`now()`),
  },
  (table) => [
    check('instance_invites_uses_within_max', sql`${table.uses} <= ${table.maxUses}`),
    // FK index: cascade deletes and "invites I created" listings.
    index('instance_invites_created_by_idx').on(table.createdBy),
  ],
);
