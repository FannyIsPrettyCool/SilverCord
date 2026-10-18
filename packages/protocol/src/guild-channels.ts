import { z } from 'zod';
import { channelNameSchema } from './channels.ts';
import { snowflakeSchema } from './snowflake.ts';

export const GUILD_CHANNEL_LIMIT = 500;
export const guildChannelTypeSchema = z.enum([
  'guild_text',
  'guild_voice',
  'guild_category',
  'announcement',
  'thread',
]);
export const guildChannelCreateTypeSchema = guildChannelTypeSchema.exclude(['thread']);
export const guildChannelSchema = z.strictObject({
  id: snowflakeSchema,
  guildId: snowflakeSchema,
  type: guildChannelTypeSchema,
  name: channelNameSchema,
  parentId: snowflakeSchema.nullable(),
  position: z
    .number()
    .int()
    .min(0)
    .max(GUILD_CHANNEL_LIMIT - 1),
  topic: z.string().max(1024).nullable(),
  archived: z.boolean(),
  version: z.number().int().positive(),
  lastMessageId: snowflakeSchema.nullable(),
  permissions: z.string().regex(/^\d{1,20}$/),
  createdAt: z.iso.datetime(),
});
export type GuildChannel = z.infer<typeof guildChannelSchema>;
export const guildChannelListSchema = z.strictObject({
  items: z.array(guildChannelSchema).max(GUILD_CHANNEL_LIMIT),
});
export type GuildChannelList = z.infer<typeof guildChannelListSchema>;
export const guildChannelCreateSchema = z
  .strictObject({
    type: guildChannelCreateTypeSchema,
    name: channelNameSchema,
    parentId: snowflakeSchema.nullable().optional(),
    topic: z.string().max(1024).nullable().optional(),
  })
  .refine((value) => value.type !== 'guild_category' || value.parentId == null, {
    path: ['parentId'],
    message: 'categories cannot have parents',
  });
export type GuildChannelCreate = z.infer<typeof guildChannelCreateSchema>;
export const guildChannelPatchSchema = z
  .strictObject({
    name: channelNameSchema.optional(),
    topic: z.string().max(1024).nullable().optional(),
    expectedVersion: z.number().int().positive(),
  })
  .refine((value) => value.name !== undefined || value.topic !== undefined, {
    message: 'at least one change required',
  });
export type GuildChannelPatch = z.infer<typeof guildChannelPatchSchema>;
export const guildChannelOrderSchema = z
  .strictObject({
    expectedVersion: z.number().int().positive(),
    items: z
      .array(
        z.strictObject({
          id: snowflakeSchema,
          parentId: snowflakeSchema.nullable(),
          position: z
            .number()
            .int()
            .min(0)
            .max(GUILD_CHANNEL_LIMIT - 1),
        }),
      )
      .min(1)
      .max(GUILD_CHANNEL_LIMIT),
  })
  .refine(({ items }) => new Set(items.map(({ id }) => id)).size === items.length, {
    path: ['items'],
    message: 'channel ids must be unique',
  })
  .refine(
    ({ items }) =>
      new Set(items.map(({ parentId, position }) => `${parentId ?? 'root'}:${position}`)).size ===
      items.length,
    { path: ['items'], message: 'positions must be unique within each parent' },
  );
export type GuildChannelOrder = z.infer<typeof guildChannelOrderSchema>;
export const guildChannelParamsSchema = z.strictObject({
  guildId: snowflakeSchema,
  channelId: snowflakeSchema,
});
