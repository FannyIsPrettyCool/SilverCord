import { DURABLE_EVENT_NAMES, type DurableEventName } from '@silvercord/protocol';
import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text } from 'drizzle-orm/pg-core';
import { snowflake, timestamptz } from '../db/columns.ts';
import { users } from '../modules/users/users-schema.ts';

const typeList = sql.raw(DURABLE_EVENT_NAMES.map((name) => `'${name}'`).join(', '));

/** Transactional outbox (ADR-0008): rows commit with the domain change they announce. */
export const eventOutbox = pgTable(
  'event_outbox',
  {
    id: snowflake().primaryKey(),
    recipientUserId: snowflake()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text().$type<DurableEventName>().notNull(),
    payload: jsonb().$type<Record<string, string>>().notNull(),
    createdAt: timestamptz().notNull().default(sql`now()`),
    availableAt: timestamptz().notNull().default(sql`now()`),
    attempts: integer().notNull().default(0),
    publishedAt: timestamptz(),
  },
  (table) => [
    check('event_outbox_type_valid', sql`${table.type} in (${typeList})`),
    check('event_outbox_attempts_positive', sql`${table.attempts} >= 0`),
    index('event_outbox_recipient_idx').on(table.recipientUserId),
    index('event_outbox_pending_idx')
      .on(table.availableAt, table.id)
      .where(sql`${table.publishedAt} is null`),
    index('event_outbox_published_idx').on(table.publishedAt),
  ],
);
