import { z } from 'zod';
import { cursorPageQuerySchema } from './pagination.ts';
import { snowflakeSchema } from './snowflake.ts';
import { publicUserSchema } from './users.ts';

/** Private channel types (docs/spec/messaging.md). Guild channels arrive in phase 3. */
export const channelTypeSchema = z.enum(['dm', 'group_dm']);
export type ChannelType = z.infer<typeof channelTypeSchema>;

export const GROUP_DM_DEFAULT_MAX_MEMBERS = 10;
/** Hard ceiling for the instance setting; the server enforces its configured maximum. */
export const GROUP_DM_MAX_MEMBERS_LIMIT = 25;
/** Counts are capped so badges never need an unbounded scan; clients show "99+". */
export const UNREAD_COUNT_CAP = 100;

export const channelNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value), { message: 'invalid characters' });

export const readStateViewSchema = z.strictObject({
  lastReadMessageId: snowflakeSchema.nullable(),
  unreadCount: z.number().int().min(0).max(UNREAD_COUNT_CAP),
  mentionCount: z.number().int().min(0).max(UNREAD_COUNT_CAP),
});
export type ReadStateView = z.infer<typeof readStateViewSchema>;

export const channelSchema = z.strictObject({
  id: snowflakeSchema,
  type: channelTypeSchema,
  name: z.string().nullable(),
  ownerId: snowflakeSchema.nullable(),
  version: z.number().int().positive(),
  lastMessageId: snowflakeSchema.nullable(),
  members: z.array(publicUserSchema),
  readState: readStateViewSchema,
  createdAt: z.iso.datetime(),
});
export type Channel = z.infer<typeof channelSchema>;

export const channelPageSchema = z.strictObject({
  items: z.array(channelSchema),
  nextBefore: snowflakeSchema.nullable(),
});
export type ChannelPage = z.infer<typeof channelPageSchema>;

export const channelListQuerySchema = cursorPageQuerySchema;

const uniqueIds = (max: number) =>
  z
    .array(snowflakeSchema)
    .min(1)
    .max(max)
    .refine((ids) => new Set(ids).size === ids.length, { message: 'ids must be unique' });

/** `{recipientId}` opens (or returns) the DM; `{recipientIds}` creates a new group. */
export const openChannelRequestSchema = z.union([
  z.strictObject({ recipientId: snowflakeSchema }),
  z.strictObject({
    recipientIds: uniqueIds(GROUP_DM_MAX_MEMBERS_LIMIT - 1),
    name: channelNameSchema.optional(),
  }),
]);
export type OpenChannelRequest = z.infer<typeof openChannelRequestSchema>;

export const channelPatchSchema = z.strictObject({
  name: channelNameSchema.nullable(),
  expectedVersion: z.number().int().positive(),
});
export type ChannelPatch = z.infer<typeof channelPatchSchema>;

export const channelParamsSchema = z.strictObject({ channelId: snowflakeSchema });
export const channelMemberParamsSchema = z.strictObject({
  channelId: snowflakeSchema,
  userId: snowflakeSchema,
});

export const readStateRequestSchema = z.strictObject({ messageId: snowflakeSchema });
export const readStateSchema = z.strictObject({
  channelId: snowflakeSchema,
  lastReadMessageId: snowflakeSchema.nullable(),
});
export type ReadState = z.infer<typeof readStateSchema>;
