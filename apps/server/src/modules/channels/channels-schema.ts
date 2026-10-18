import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';
import { snowflake, timestamptz } from '../../db/columns.ts';
import { users } from '../users/users-schema.ts';

/** Private channels (docs/spec/messaging.md); phase 3 widens `type` for guild channels. */
export const channels = pgTable(
  'channels',
  {
    id: snowflake().primaryKey(),
    type: text({ enum: ['dm', 'group_dm'] }).notNull(),
    // Groups only; ownership moves to the smallest remaining member id when the owner leaves.
    ownerId: snowflake().references(() => users.id, { onDelete: 'set null' }),
    name: text(),
    version: integer().notNull().default(1),
    lastMessageId: snowflake(),
    createdAt: timestamptz().notNull().default(sql`now()`),
    updatedAt: timestamptz().notNull().default(sql`now()`),
  },
  (table) => [
    check('channels_type_valid', sql`${table.type} in ('dm', 'group_dm')`),
    check(
      'channels_name_length',
      sql`${table.name} is null or char_length(${table.name}) between 1 and 100`,
    ),
    check(
      'channels_dm_shape',
      sql`${table.type} <> 'dm' or (${table.ownerId} is null and ${table.name} is null)`,
    ),
    check('channels_version_positive', sql`${table.version} > 0`),
    index('channels_owner_idx').on(table.ownerId),
  ],
);

/** Exactly one DM per user pair; concurrent opens converge on the same channel. */
export const dmPairs = pgTable(
  'dm_pairs',
  {
    userLow: snowflake()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    userHigh: snowflake()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    channelId: snowflake()
      .notNull()
      .unique()
      .references(() => channels.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.userLow, table.userHigh] }),
    check('dm_pairs_ordered', sql`${table.userLow} < ${table.userHigh}`),
    index('dm_pairs_high_idx').on(table.userHigh),
  ],
);

export const channelMembers = pgTable(
  'channel_members',
  {
    channelId: snowflake()
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    userId: snowflake()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    joinedAt: timestamptz().notNull().default(sql`now()`),
  },
  (table) => [
    primaryKey({ columns: [table.channelId, table.userId] }),
    index('channel_members_user_channel_idx').on(table.userId, table.channelId.desc()),
  ],
);

export type ChannelRow = typeof channels.$inferSelect;
