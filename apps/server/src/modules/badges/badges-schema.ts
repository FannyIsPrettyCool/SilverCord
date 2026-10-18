import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  unique,
} from 'drizzle-orm/pg-core';
import { snowflake, timestamptz } from '../../db/columns.ts';
import { mediaUploads } from '../media/media-schema.ts';
import { users } from '../users/users-schema.ts';

const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'] as const;

/** docs/spec/badges.md. Built-ins carry a key; manual badges carry their own text. */
export const badgeDefinitions = pgTable(
  'badge_definitions',
  {
    id: snowflake().primaryKey(),
    key: text().unique(),
    name: text().notNull(),
    description: text().notNull().default(''),
    rarity: text({ enum: RARITIES }).notNull(),
    iconName: text(),
    iconUploadId: snowflake().references(() => mediaUploads.id, { onDelete: 'set null' }),
    /** Null for manual badges; built-in rules are identified by `key`. */
    rule: jsonb().$type<{ readonly type: string }>(),
    retired: boolean().notNull().default(false),
    createdAt: timestamptz().notNull().default(sql`now()`),
  },
  (table) => [
    check('badge_definitions_name_length', sql`char_length(${table.name}) between 1 and 32`),
    check('badge_definitions_description_length', sql`char_length(${table.description}) <= 140`),
    check(
      'badge_definitions_rarity_valid',
      sql`${table.rarity} in ('common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic')`,
    ),
    check(
      'badge_definitions_one_icon',
      // At most one icon source; both null (a deleted upload) falls back to a default medallion.
      sql`${table.iconName} is null or ${table.iconUploadId} is null`,
    ),
  ],
);

export const userBadges = pgTable(
  'user_badges',
  {
    userId: snowflake()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    badgeId: snowflake()
      .notNull()
      .references(() => badgeDefinitions.id, { onDelete: 'cascade' }),
    level: integer().notNull().default(1),
    awardedAt: timestamptz().notNull().default(sql`now()`),
    awardedBy: snowflake().references(() => users.id, { onDelete: 'set null' }),
    reason: text(),
    pin: smallint(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.badgeId] }),
    unique('user_badges_pin_unique').on(table.userId, table.pin),
    check('user_badges_level_positive', sql`${table.level} >= 1`),
    check('user_badges_pin_range', sql`${table.pin} is null or ${table.pin} between 0 and 5`),
    check('user_badges_reason_length', sql`char_length(${table.reason}) <= 200`),
    index('user_badges_badge_idx').on(table.badgeId),
  ],
);

export type BadgeDefinitionRow = typeof badgeDefinitions.$inferSelect;
export type UserBadgeRow = typeof userBadges.$inferSelect;
