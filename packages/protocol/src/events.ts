import { z } from 'zod';
import { snowflakeSchema } from './snowflake.ts';

/*
 * Phase 2 dispatch events are content-free invalidations (ADR-0008): clients refetch the
 * authorized REST resource, so replay can never disclose text after access is lost.
 */

/** Durable: written to the transactional outbox with the domain change. */
export const relationshipsChangedSchema = z.strictObject({ eventId: snowflakeSchema });
export const channelChangedSchema = z.strictObject({
  eventId: snowflakeSchema,
  channelId: snowflakeSchema,
});
export const messageChangedSchema = z.strictObject({
  eventId: snowflakeSchema,
  channelId: snowflakeSchema,
  messageId: snowflakeSchema,
});
export const readStateChangedSchema = z.strictObject({
  eventId: snowflakeSchema,
  channelId: snowflakeSchema,
});

export const durableEventSchemas = {
  RELATIONSHIPS_CHANGED: relationshipsChangedSchema,
  CHANNEL_CHANGED: channelChangedSchema,
  MESSAGE_CHANGED: messageChangedSchema,
  READ_STATE_CHANGED: readStateChangedSchema,
} as const;
export type DurableEventName = keyof typeof durableEventSchemas;
export const DURABLE_EVENT_NAMES = Object.keys(durableEventSchemas) as DurableEventName[];
export type DurableEventData<T extends DurableEventName> = z.infer<(typeof durableEventSchemas)[T]>;

/** Transient: published directly, coalesced, never replayed as state. */
export const presenceChangedSchema = z.strictObject({ userId: snowflakeSchema });
export const typingChangedSchema = z.strictObject({ channelId: snowflakeSchema });
export const mediaChangedSchema = z.strictObject({ uploadId: snowflakeSchema });

export const transientEventSchemas = {
  PRESENCE_CHANGED: presenceChangedSchema,
  TYPING_CHANGED: typingChangedSchema,
  MEDIA_CHANGED: mediaChangedSchema,
} as const;
