import { z } from 'zod';
import { ATTACHMENTS_PER_MESSAGE_MAX, attachmentSchema } from './media.ts';
import { cursorPageQuerySchema } from './pagination.ts';
import { snowflakeSchema } from './snowflake.ts';
import { publicUserSchema } from './users.ts';

/** docs/spec/messaging.md */
export const MESSAGE_MAX_CODE_POINTS = 4000;
export const MESSAGE_MAX_BYTES = 16 * 1024;
export const REPLY_EXCERPT_MAX = 200;
export const REACTIONS_DISTINCT_MAX = 20;

/** UTF-8 length without TextEncoder, so the contract has no DOM/Node lib dependency. */
function utf8Length(value: string): number {
  let bytes = 0;
  for (const char of value) {
    const point = char.codePointAt(0) ?? 0;
    bytes += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/** Whitespace is preserved; NUL and lone surrogates are refused rather than normalized. */
export const messageContentSchema = z
  .string()
  .refine((value) => value.isWellFormed() && !value.includes('\0'), {
    message: 'invalid characters',
  })
  .refine((value) => [...value].length <= MESSAGE_MAX_CODE_POINTS, {
    message: `at most ${MESSAGE_MAX_CODE_POINTS} characters`,
  })
  .refine((value) => utf8Length(value) <= MESSAGE_MAX_BYTES, {
    message: 'message too large',
  });

const uniqueIds = z
  .array(snowflakeSchema)
  .max(ATTACHMENTS_PER_MESSAGE_MAX)
  .refine((ids) => new Set(ids).size === ids.length, { message: 'ids must be unique' });

export const createMessageRequestSchema = z.strictObject({
  content: messageContentSchema.default(''),
  replyToId: snowflakeSchema.nullable().optional(),
  attachmentIds: uniqueIds.optional(),
});
export type CreateMessageRequest = z.input<typeof createMessageRequestSchema>;

/** Required on message create; one UUID v4 per logical send, reused across retries. */
export const idempotencyHeadersSchema = z.object({
  'idempotency-key': z.uuid({ version: 'v4' }),
});

export const editMessageRequestSchema = z.strictObject({
  content: messageContentSchema,
  expectedVersion: z.number().int().positive(),
});
export type EditMessageRequest = z.infer<typeof editMessageRequestSchema>;

/**
 * One fully-qualified RGI emoji sequence, or `custom:<emoteId>` for a custom emote the actor
 * may use (docs/spec/expressions.md).
 */
export const reactionEmojiSchema = z
  .string()
  .min(1)
  .max(64)
  .refine((value) => /^\p{RGI_Emoji}$/v.test(value) || /^custom:\d{1,20}$/.test(value), {
    message: 'must be a single emoji',
  });

export const messageParamsSchema = z.strictObject({
  channelId: snowflakeSchema,
  messageId: snowflakeSchema,
});
export const reactionParamsSchema = z.strictObject({
  channelId: snowflakeSchema,
  messageId: snowflakeSchema,
  emoji: reactionEmojiSchema,
});

export const reactionSummarySchema = z.strictObject({
  emoji: z.string(),
  count: z.number().int().positive(),
  me: z.boolean(),
});
export type ReactionSummary = z.infer<typeof reactionSummarySchema>;

/** A reply reference never crosses channels; deleted targets leave only `missing`. */
export const messageReplySchema = z.discriminatedUnion('state', [
  z.strictObject({
    state: z.literal('visible'),
    id: snowflakeSchema,
    author: publicUserSchema.nullable(),
    excerpt: z.string().max(REPLY_EXCERPT_MAX + 1),
  }),
  z.strictObject({ state: z.literal('hidden'), id: snowflakeSchema }),
  z.strictObject({ state: z.literal('missing') }),
]);
export type MessageReply = z.infer<typeof messageReplySchema>;

export const visibleMessageSchema = z.strictObject({
  id: snowflakeSchema,
  channelId: snowflakeSchema,
  hidden: z.literal(false),
  /** Null when the author's account was deleted. */
  author: publicUserSchema.nullable(),
  content: z.string(),
  mentions: z.array(snowflakeSchema),
  reply: messageReplySchema.nullable(),
  reactions: z.array(reactionSummarySchema),
  attachments: z.array(attachmentSchema),
  version: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  editedAt: z.iso.datetime().nullable(),
});
export type VisibleMessage = z.infer<typeof visibleMessageSchema>;

/** What a viewer sees in place of a message from someone they blocked. */
export const hiddenMessageSchema = z.strictObject({
  id: snowflakeSchema,
  channelId: snowflakeSchema,
  hidden: z.literal(true),
});
export type HiddenMessage = z.infer<typeof hiddenMessageSchema>;

export const messageSchema = z.discriminatedUnion('hidden', [
  visibleMessageSchema,
  hiddenMessageSchema,
]);
export type Message = z.infer<typeof messageSchema>;

export const messagePageSchema = z.strictObject({
  /** Always newest first. */
  items: z.array(messageSchema),
  nextBefore: snowflakeSchema.nullable(),
  nextAfter: snowflakeSchema.nullable(),
});
export type MessagePage = z.infer<typeof messagePageSchema>;

export const messageListQuerySchema = cursorPageQuerySchema;
