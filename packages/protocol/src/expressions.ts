import { z } from 'zod';
import { profileImageSchema } from './profile-media.ts';
import { snowflakeSchema } from './snowflake.ts';

/** docs/spec/expressions.md */
export const EMOTES_PER_GUILD = { static: 250, animated: 250 } as const;
export const STICKERS_PER_GUILD = 60;
export const STICKERS_PER_MESSAGE = 3;
export const LOOKUP_MAX_IDS = 100;

export const emoteNameSchema = z
  .string()
  .regex(/^[A-Za-z0-9_]{2,32}$/, '2–32 letters, digits or _');
const stickerNameSchema = z
  .string()
  .trim()
  .min(2)
  .max(30)
  .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value), { message: 'invalid characters' });
const stickerDescriptionSchema = z
  .string()
  .trim()
  .max(100)
  .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value), { message: 'invalid characters' });
const unicodeEmojiSchema = z.string().regex(/^\p{RGI_Emoji}$/v, 'must be a single emoji');

export const emoteSchema = z.strictObject({
  id: snowflakeSchema,
  guildId: snowflakeSchema,
  name: z.string(),
  animated: z.boolean(),
  image: profileImageSchema,
});
export type Emote = z.infer<typeof emoteSchema>;

export const stickerSchema = z.strictObject({
  id: snowflakeSchema,
  guildId: snowflakeSchema,
  name: z.string(),
  description: z.string(),
  relatedEmoji: z.string().nullable(),
  animated: z.boolean(),
  image: profileImageSchema,
});
export type Sticker = z.infer<typeof stickerSchema>;

export const guildExpressionsSchema = z.strictObject({
  emotes: z.array(emoteSchema),
  stickers: z.array(stickerSchema),
});
export type GuildExpressions = z.infer<typeof guildExpressionsSchema>;

/** Picker data: every guild the user is in, with what they may use from it. */
export const usableExpressionsSchema = z.strictObject({
  guilds: z.array(
    z.strictObject({
      guildId: snowflakeSchema,
      name: z.string(),
      emotes: z.array(emoteSchema),
      stickers: z.array(stickerSchema),
    }),
  ),
});
export type UsableExpressions = z.infer<typeof usableExpressionsSchema>;

export const createEmoteRequestSchema = z.strictObject({
  name: emoteNameSchema,
  uploadId: snowflakeSchema,
});
export const emotePatchSchema = z.strictObject({ name: emoteNameSchema });
export const createStickerRequestSchema = z.strictObject({
  name: stickerNameSchema,
  description: stickerDescriptionSchema,
  relatedEmoji: unicodeEmojiSchema.nullable(),
  uploadId: snowflakeSchema,
});
export const stickerPatchSchema = z
  .strictObject({
    name: stickerNameSchema.optional(),
    description: stickerDescriptionSchema.optional(),
    relatedEmoji: unicodeEmojiSchema.nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'provide a field' });
export const emoteParamsSchema = z.strictObject({
  guildId: snowflakeSchema,
  emoteId: snowflakeSchema,
});
export const stickerParamsSchema = z.strictObject({
  guildId: snowflakeSchema,
  stickerId: snowflakeSchema,
});

const idList = z
  .string()
  .max(2100)
  .transform((value) => (value === '' ? [] : value.split(',')))
  .pipe(z.array(snowflakeSchema).max(LOOKUP_MAX_IDS));

export const expressionLookupQuerySchema = z
  .strictObject({ emoteIds: idList.optional(), stickerIds: idList.optional() })
  .refine((value) => (value.emoteIds?.length ?? 0) + (value.stickerIds?.length ?? 0) > 0, {
    message: 'provide ids',
  });

/** Rendering data for ids found in messages; deleted ones are simply absent. */
export const expressionLookupSchema = z.strictObject({
  emotes: z.array(emoteSchema),
  stickers: z.array(stickerSchema),
});
export type ExpressionLookup = z.infer<typeof expressionLookupSchema>;

/** Reactions take one unicode emoji or `custom:<emoteId>` (docs/spec/expressions.md). */
export const CUSTOM_REACTION_PATTERN = /^custom:(\d{1,20})$/;
