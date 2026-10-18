import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { bytea, snowflake, timestamptz } from '../../db/columns.ts';
import { channels } from '../channels/channels-schema.ts';
import { users } from '../users/users-schema.ts';

export const messages = pgTable(
  'messages',
  {
    id: snowflake().primaryKey(),
    channelId: snowflake()
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    authorId: snowflake().references(() => users.id, { onDelete: 'set null' }),
    content: text().notNull(),
    // Same-channel reply enforced by a composite FK in the migration; deleting the target
    // nulls only reply_to_id, and is_reply keeps the "missing reference" placeholder.
    replyToId: snowflake(),
    isReply: boolean().notNull().default(false),
    version: integer().notNull().default(1),
    createdAt: timestamptz().notNull().default(sql`now()`),
    editedAt: timestamptz(),
  },
  (table) => [
    unique('messages_channel_id_unique').on(table.channelId, table.id),
    check('messages_version_positive', sql`${table.version} > 0`),
    check('messages_reply_flag', sql`${table.replyToId} is null or ${table.isReply}`),
    index('messages_channel_id_idx').on(table.channelId, table.id.desc()),
    index('messages_author_idx').on(table.authorId),
    index('messages_reply_to_idx').on(table.replyToId),
  ],
);

/**
 * Retained until account deletion so a retried send never creates a second message, and never
 * restores a deleted one. message_id deliberately has no FK and keeps no content.
 */
export const messageIdempotency = pgTable(
  'message_idempotency',
  {
    authorId: snowflake()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    key: uuid().notNull(),
    channelId: snowflake().notNull(),
    requestHash: bytea().notNull(),
    messageId: snowflake().notNull(),
    createdAt: timestamptz().notNull().default(sql`now()`),
  },
  (table) => [
    primaryKey({ columns: [table.authorId, table.key] }),
    index('message_idempotency_message_idx').on(table.messageId),
  ],
);

export const messageReactions = pgTable(
  'message_reactions',
  {
    messageId: snowflake()
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    userId: snowflake()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    emoji: text().notNull(),
    createdAt: timestamptz().notNull().default(sql`now()`),
  },
  (table) => [
    primaryKey({ columns: [table.messageId, table.userId, table.emoji] }),
    check('message_reactions_emoji_length', sql`octet_length(${table.emoji}) between 1 and 64`),
    index('message_reactions_user_idx').on(table.userId),
  ],
);

export const messageMentions = pgTable(
  'message_mentions',
  {
    messageId: snowflake()
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    userId: snowflake()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.messageId, table.userId] }),
    index('message_mentions_user_message_idx').on(table.userId, table.messageId),
  ],
);

/** Own high-water mark per channel; private to the account (no peer read receipts in v1). */
export const readStates = pgTable(
  'read_states',
  {
    userId: snowflake()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    channelId: snowflake()
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    lastReadMessageId: snowflake(),
    updatedAt: timestamptz().notNull().default(sql`now()`),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.channelId] }),
    index('read_states_channel_idx').on(table.channelId),
  ],
);

export type MessageRow = typeof messages.$inferSelect;
