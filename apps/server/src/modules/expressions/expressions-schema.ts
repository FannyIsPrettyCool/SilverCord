import { sql } from 'drizzle-orm';
import { boolean, check, index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { snowflake, timestamptz } from '../../db/columns.ts';
import { guilds } from '../guilds/guilds-schema.ts';
import { mediaUploads } from '../media/media-schema.ts';
import { users } from '../users/users-schema.ts';

/** docs/spec/expressions.md */
export const guildEmotes = pgTable(
  'guild_emotes',
  {
    id: snowflake().primaryKey(),
    guildId: snowflake()
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    // NO ACTION (checked at statement end): guild deletion cascades emotes and uploads together.
    uploadId: snowflake()
      .notNull()
      .references(() => mediaUploads.id),
    animated: boolean().notNull().default(false),
    createdBy: snowflake().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamptz().notNull().default(sql`now()`),
  },
  (table) => [
    check('guild_emotes_name_valid', sql`${table.name} ~ '^[A-Za-z0-9_]{2,32}$'`),
    uniqueIndex('guild_emotes_guild_name_unique').on(table.guildId, sql`lower(${table.name})`),
    uniqueIndex('guild_emotes_upload_unique').on(table.uploadId),
    index('guild_emotes_guild_idx').on(table.guildId),
  ],
);

export const guildStickers = pgTable(
  'guild_stickers',
  {
    id: snowflake().primaryKey(),
    guildId: snowflake()
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    description: text().notNull().default(''),
    relatedEmoji: text(),
    uploadId: snowflake()
      .notNull()
      .references(() => mediaUploads.id),
    animated: boolean().notNull().default(false),
    createdBy: snowflake().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamptz().notNull().default(sql`now()`),
  },
  (table) => [
    check('guild_stickers_name_length', sql`char_length(${table.name}) between 2 and 30`),
    check('guild_stickers_description_length', sql`char_length(${table.description}) <= 100`),
    uniqueIndex('guild_stickers_upload_unique').on(table.uploadId),
    index('guild_stickers_guild_idx').on(table.guildId),
  ],
);

export type EmoteRow = typeof guildEmotes.$inferSelect;
export type StickerRow = typeof guildStickers.$inferSelect;
