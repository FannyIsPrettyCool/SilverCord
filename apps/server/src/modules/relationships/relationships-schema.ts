import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, primaryKey, text, unique } from 'drizzle-orm/pg-core';
import { snowflake, timestamptz } from '../../db/columns.ts';
import { users } from '../users/users-schema.ts';

export const socialPrivacy = pgTable(
  'social_privacy',
  {
    userId: snowflake()
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    friendRequests: text({ enum: ['everyone', 'nobody'] })
      .notNull()
      .default('everyone'),
    directMessages: text({ enum: ['friends', 'nobody'] })
      .notNull()
      .default('friends'),
    version: integer().notNull().default(1),
  },
  (table) => [
    check('social_privacy_requests_valid', sql`${table.friendRequests} in ('everyone', 'nobody')`),
    check('social_privacy_messages_valid', sql`${table.directMessages} in ('friends', 'nobody')`),
    check('social_privacy_version_positive', sql`${table.version} > 0`),
  ],
);

export const relationshipPairs = pgTable(
  'relationship_pairs',
  {
    id: snowflake().notNull().unique(),
    userLow: snowflake()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    userHigh: snowflake()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    state: text({ enum: ['none', 'pending', 'friends'] })
      .notNull()
      .default('none'),
    requestedBy: snowflake(),
    version: integer().notNull().default(1),
    createdAt: timestamptz().notNull().default(sql`now()`),
    updatedAt: timestamptz().notNull().default(sql`now()`),
  },
  (table) => [
    primaryKey({ columns: [table.userLow, table.userHigh] }),
    check('relationship_pairs_ordered', sql`${table.userLow} < ${table.userHigh}`),
    check('relationship_pairs_state_valid', sql`${table.state} in ('none', 'pending', 'friends')`),
    check(
      'relationship_pairs_request_valid',
      sql`(${table.state} = 'pending' and ${table.requestedBy} is not null and ${table.requestedBy} in (${table.userLow}, ${table.userHigh})) or (${table.state} <> 'pending' and ${table.requestedBy} is null)`,
    ),
    check('relationship_pairs_version_positive', sql`${table.version} > 0`),
    index('relationship_pairs_low_id_idx').on(table.userLow, table.id.desc()),
    index('relationship_pairs_high_id_idx').on(table.userHigh, table.id.desc()),
  ],
);

export const userBlocks = pgTable(
  'user_blocks',
  {
    id: snowflake().primaryKey(),
    ownerId: snowflake()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    targetId: snowflake()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamptz().notNull().default(sql`now()`),
  },
  (table) => [
    unique('user_blocks_owner_target_unique').on(table.ownerId, table.targetId),
    check('user_blocks_not_self', sql`${table.ownerId} <> ${table.targetId}`),
    index('user_blocks_target_owner_idx').on(table.targetId, table.ownerId),
    index('user_blocks_owner_id_idx').on(table.ownerId, table.id.desc()),
  ],
);

export const relationshipMetadata = pgTable(
  'relationship_metadata',
  {
    ownerId: snowflake()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    targetId: snowflake()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    nickname: text(),
    note: text(),
    updatedAt: timestamptz().notNull().default(sql`now()`),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.targetId] }),
    check('relationship_metadata_not_self', sql`${table.ownerId} <> ${table.targetId}`),
    check(
      'relationship_metadata_nickname_length',
      sql`${table.nickname} is null or char_length(${table.nickname}) between 1 and 32`,
    ),
    check(
      'relationship_metadata_note_length',
      sql`${table.note} is null or char_length(${table.note}) <= 1000`,
    ),
    index('relationship_metadata_target_idx').on(table.targetId),
  ],
);
