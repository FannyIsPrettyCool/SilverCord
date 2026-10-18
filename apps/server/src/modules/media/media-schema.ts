import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
} from 'drizzle-orm/pg-core';
import { bytea, snowflake, timestamptz } from '../../db/columns.ts';
import { channels } from '../channels/channels-schema.ts';
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

/** A file reserved for one channel by its owner (docs/spec/media.md). */
export const mediaUploads = pgTable(
  'media_uploads',
  {
    id: snowflake().primaryKey(),
    ownerId: snowflake()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    channelId: snowflake()
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
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
    check('media_uploads_filename_length', sql`char_length(${table.filename}) between 1 and 128`),
    check(
      'media_uploads_bytes_valid',
      sql`${table.sizeBytes} > 0 and ${table.receivedBytes} between 0 and ${table.sizeBytes} and ${table.reservedBytes} >= 0 and ${table.storedBytes} >= 0`,
    ),
    index('media_uploads_owner_state_idx').on(table.ownerId, table.state),
    index('media_uploads_channel_idx').on(table.channelId),
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
    variant: text({ enum: ['display', 'thumbnail', 'download'] }).notNull(),
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
      sql`${table.variant} in ('display', 'thumbnail', 'download')`,
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
