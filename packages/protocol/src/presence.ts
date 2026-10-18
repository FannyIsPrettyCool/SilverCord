import { z } from 'zod';
import { snowflakeSchema } from './snowflake.ts';

/** docs/spec/presence.md. Presence is ephemeral and never evidence of reading. */
export const presencePreferenceSchema = z.enum(['online', 'idle', 'dnd', 'invisible']);
export type PresencePreference = z.infer<typeof presencePreferenceSchema>;

/** What peers see; invisible, disconnected and privacy-denied all read as offline. */
export const presenceStatusSchema = z.enum(['online', 'idle', 'dnd', 'offline']);
export type PresenceStatus = z.infer<typeof presenceStatusSchema>;

export const PRESENCE_QUERY_MAX_IDS = 100;
export const TYPING_TTL_MS = 8_000;

export const presenceQuerySchema = z.strictObject({
  userIds: z
    .string()
    .max(2000)
    .transform((value) => value.split(','))
    .pipe(
      z
        .array(snowflakeSchema)
        .min(1)
        .max(PRESENCE_QUERY_MAX_IDS)
        .refine((ids) => new Set(ids).size === ids.length, { message: 'ids must be unique' }),
    ),
});

export const presenceEntrySchema = z.strictObject({
  userId: snowflakeSchema,
  status: presenceStatusSchema,
  observedAt: z.iso.datetime(),
});
export type PresenceEntry = z.infer<typeof presenceEntrySchema>;

export const presenceSnapshotSchema = z.strictObject({ items: z.array(presenceEntrySchema) });
export type PresenceSnapshot = z.infer<typeof presenceSnapshotSchema>;

export const ownPresenceSchema = z.strictObject({ status: presencePreferenceSchema });
export type OwnPresence = z.infer<typeof ownPresenceSchema>;

export const typingRequestSchema = z.strictObject({ active: z.boolean() });

export const typingSnapshotSchema = z.strictObject({
  items: z.array(z.strictObject({ userId: snowflakeSchema, expiresAt: z.iso.datetime() })),
});
export type TypingSnapshot = z.infer<typeof typingSnapshotSchema>;
