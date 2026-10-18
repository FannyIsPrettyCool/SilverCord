import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
} from 'drizzle-orm/pg-core';
import { bytea, snowflake, timestamptz } from '../../db/columns.ts';
import { channels } from '../channels/channels-schema.ts';
import { guilds } from '../guilds/guilds-schema.ts';
import { messages } from '../messages/messages-schema.ts';
import { users } from '../users/users-schema.ts';

const UPLOAD_STATES = [
  'uploading',
  'processing',
  'ready',
  'attached',
  'failed',
  'deleting',
] as const;

export const UPLOAD_PURPOSES = [
  'attachment',
  'avatar',
  'banner',
  'guild_avatar',
  'guild_banner',
  'emote',
  'sticker',
  'badge_icon',
] as const;
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];

/**
 * A file reserved by its owner for one channel (docs/spec/media.md) or, for profile-class
 * purposes, for an account, guild or the instance (ADR-0011).
 */
export const mediaUploads = pgTable(
  'media_uploads',
  {
    id: snowflake().primaryKey(),
    ownerId: snowflake()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: text({ enum: UPLOAD_PURPOSES }).notNull().default('attachment'),
    channelId: snowflake().references(() => channels.id, { onDelete: 'cascade' }),
    guildId: snowflake().references(() => guilds.id, { onDelete: 'cascade' }),
    /** Source-pixel crop requested at completion; applied by the decoder. */
    crop: jsonb().$type<{ x: number; y: number; width: number; height: number }>(),
    dominantColor: integer(),
    filename: text().notNull(),
    sizeBytes: bigint({ mode: 'number' }).notNull(),
    receivedBytes: bigint({ mode: 'number' }).notNull().default(0),
    /** Quota held for source + derived files until processing settles actual usage. */
    reservedBytes: bigint({ mode: 'number' }).notNull().default(0),
    storedBytes: bigint({ mode: 'number' }).notNull().default(0),
    state: text({ enum: UPLOAD_STATES }).notNull().default('uploading'),
    detectedMime: text(),
    kind: text({ enum: ['image', 'video', 'file'] }),
    width: integer(),
    height: integer(),
    durationMs: integer(),
    blurhash: text(),
    animated: boolean().notNull().default(false),
    failure: text(),
    version: integer().notNull().default(1),
    createdAt: timestamptz().notNull().default(sql`now()`),
    expiresAt: timestamptz().notNull(),
  },
  (table) => [
    check(
      'media_uploads_state_valid',
      sql`${table.state} in ('uploading', 'processing', 'ready', 'attached', 'failed', 'deleting')`,
    ),
    check(
      'media_uploads_purpose_scope',
      sql`(${table.purpose} = 'attachment' and ${table.channelId} is not null and ${table.guildId} is null) or (${table.purpose} in ('guild_avatar', 'guild_banner', 'emote', 'sticker') and ${table.guildId} is not null and ${table.channelId} is null) or (${table.purpose} in ('avatar', 'banner', 'badge_icon') and ${table.channelId} is null and ${table.guildId} is null)`,
    ),
    check(
      'media_uploads_dominant_color_range',
      sql`${table.dominantColor} is null or ${table.dominantColor} between 0 and 16777215`,
    ),
    check('media_uploads_filename_length', sql`char_length(${table.filename}) between 1 and 128`),
    check(
      'media_uploads_bytes_valid',
      sql`${table.sizeBytes} > 0 and ${table.receivedBytes} between 0 and ${table.sizeBytes} and ${table.reservedBytes} >= 0 and ${table.storedBytes} >= 0`,
    ),
    index('media_uploads_owner_state_idx').on(table.ownerId, table.state),
    index('media_uploads_channel_idx').on(table.channelId),
    index('media_uploads_guild_idx').on(table.guildId),
    index('media_uploads_state_expiry_idx').on(table.state, table.expiresAt),
  ],
);

/** Committed chunk ledger: resume and retry without trusting a client checksum. */
export const mediaUploadChunks = pgTable(
  'media_upload_chunks',
  {
    uploadId: snowflake()
      .notNull()
      .references(() => mediaUploads.id, { onDelete: 'cascade' }),
    offset: bigint({ mode: 'number' }).notNull(),
    length: integer().notNull(),
    sha256: bytea().notNull(),
    storageKey: text().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.uploadId, table.offset] }),
    check('media_upload_chunks_length_positive', sql`${table.length} > 0`),
  ],
);

export const mediaVariants = pgTable(
  'media_variants',
  {
    uploadId: snowflake()
      .notNull()
      .references(() => mediaUploads.id, { onDelete: 'cascade' }),
    variant: text({ enum: ['display', 'thumbnail', 'download', 'still'] }).notNull(),
    storageKey: text().notNull(),
    sha256: text().notNull(),
    sizeBytes: bigint({ mode: 'number' }).notNull(),
    mime: text().notNull(),
    width: integer(),
    height: integer(),
  },
  (table) => [
    primaryKey({ columns: [table.uploadId, table.variant] }),
    check(
      'media_variants_variant_valid',
      sql`${table.variant} in ('display', 'thumbnail', 'download', 'still')`,
    ),
    check('media_variants_hash_hex', sql`${table.sha256} ~ '^[a-f0-9]{64}$'`),
  ],
);

/** One upload belongs to at most one message. */
export const messageAttachments = pgTable(
  'message_attachments',
  {
    messageId: snowflake()
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    uploadId: snowflake()
      .notNull()
      .unique()
      .references(() => mediaUploads.id, { onDelete: 'cascade' }),
    position: integer().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.messageId, table.uploadId] }),
    check('message_attachments_position_range', sql`${table.position} between 0 and 9`),
  ],
);

/** `instance` or `user:<snowflake>`; repaired from upload rows by reconciliation. */
export const mediaQuotaUsage = pgTable(
  'media_quota_usage',
  {
    scope: text().primaryKey(),
    reservedBytes: bigint({ mode: 'number' }).notNull().default(0),
    storedBytes: bigint({ mode: 'number' }).notNull().default(0),
  },
  (table) => [
    check(
      'media_quota_usage_nonnegative',
      sql`${table.reservedBytes} >= 0 and ${table.storedBytes} >= 0`,
    ),
  ],
);

export type UploadRow = typeof mediaUploads.$inferSelect;
export type VariantRow = typeof mediaVariants.$inferSelect;
