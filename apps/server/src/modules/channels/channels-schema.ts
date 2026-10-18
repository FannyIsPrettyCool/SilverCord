import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  unique,
} from 'drizzle-orm/pg-core';
import { snowflake, timestamptz } from '../../db/columns.ts';
import { guilds } from '../guilds/guilds-schema.ts';
import { users } from '../users/users-schema.ts';

/** Private conversations and guild channels (docs/spec/messaging.md, docs/spec/guilds.md). */
export const channels = pgTable(
  'channels',
  {
    id: snowflake().primaryKey(),
    type: text({
      enum: [
        'dm',
        'group_dm',
        'guild_text',
        'guild_voice',
        'guild_category',
        'announcement',
        'thread',
      ],
    }).notNull(),
    guildId: snowflake().references(() => guilds.id, { onDelete: 'cascade' }),
    parentId: snowflake(),
    position: integer().notNull().default(0),
    topic: text(),
    archived: boolean().notNull().default(false),
    // Groups only; ownership moves to the smallest remaining member id when the owner leaves.
    ownerId: snowflake().references(() => users.id, { onDelete: 'set null' }),
    name: text(),
    version: integer().notNull().default(1),
    lastMessageId: snowflake(),
    createdAt: timestamptz().notNull().default(sql`now()`),
    updatedAt: timestamptz().notNull().default(sql`now()`),
  },
  (table) => [
    check(
      'channels_type_valid',
      sql`${table.type} in ('dm', 'group_dm', 'guild_text', 'guild_voice', 'guild_category', 'announcement', 'thread')`,
    ),
    check(
      'channels_guild_shape',
      sql`case when ${table.type} in ('dm', 'group_dm') then ${table.guildId} is null and ${table.parentId} is null and ${table.topic} is null and ${table.position} = 0 and not ${table.archived} else ${table.guildId} is not null and ${table.ownerId} is null and ${table.name} is not null end`,
    ),
    check('channels_position_nonnegative', sql`${table.position} >= 0`),
    check(
      'channels_topic_length',
      sql`${table.topic} is null or char_length(${table.topic}) <= 1024`,
    ),
    check('channels_archived_thread', sql`not ${table.archived} or ${table.type} = 'thread'`),
    check(
      'channels_parent_shape',
      sql`(${table.parentId} is null or ${table.parentId} <> ${table.id}) and (${table.type} <> 'guild_category' or ${table.parentId} is null) and (${table.type} <> 'thread' or ${table.parentId} is not null)`,
    ),
    unique('channels_id_guild_unique').on(table.id, table.guildId),
    foreignKey({
      name: 'channels_parent_guild_fk',
      columns: [table.parentId, table.guildId],
      foreignColumns: [table.id, table.guildId],
    }).onDelete('cascade'),
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
    index('channels_guild_position_idx').on(table.guildId, table.position),
    index('channels_parent_idx').on(table.parentId),
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

export const channelOverwrites = pgTable(
  'channel_overwrites',
  {
    channelId: snowflake()
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    targetType: text({ enum: ['role', 'member'] }).notNull(),
    targetId: snowflake().notNull(),
    allow: bigint({ mode: 'bigint' }).notNull().default(sql`0`),
    deny: bigint({ mode: 'bigint' }).notNull().default(sql`0`),
  },
  (table) => [
    primaryKey({ columns: [table.channelId, table.targetType, table.targetId] }),
    check('channel_overwrites_target_type', sql`${table.targetType} in ('role', 'member')`),
    // CHANNEL_SCOPE (stable stored bits): guild-only permissions cannot be overwritten.
    check(
      'channel_overwrites_scope',
      sql`${table.allow} >= 0 and ${table.deny} >= 0 and (${table.allow} & ~406847487::bigint) = 0 and (${table.deny} & ~406847487::bigint) = 0`,
    ),
  ],
);
