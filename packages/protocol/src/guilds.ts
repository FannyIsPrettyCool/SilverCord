import { z } from 'zod';
import { snowflakeSchema } from './snowflake.ts';

const guildNameSchema = z.string().trim().min(1).max(100);
export const guildParamsSchema = z.strictObject({ guildId: snowflakeSchema });
export const createGuildRequestSchema = z.strictObject({ name: guildNameSchema });
export const guildPatchSchema = z.strictObject({
  name: guildNameSchema,
  expectedVersion: z.number().int().positive(),
});
export const guildSchema = z.strictObject({
  id: snowflakeSchema,
  name: guildNameSchema,
  ownerId: snowflakeSchema,
  version: z.number().int().positive(),
  memberCount: z.number().int().positive(),
  permissions: z.string().regex(/^\d{1,20}$/),
  createdAt: z.iso.datetime(),
});
export const guildListSchema = z.strictObject({ items: z.array(guildSchema).max(100) });
export const guildChangedSchema = z.strictObject({
  eventId: snowflakeSchema,
  guildId: snowflakeSchema,
});

export type Guild = z.infer<typeof guildSchema>;
export type CreateGuildRequest = z.infer<typeof createGuildRequestSchema>;
export type GuildPatch = z.infer<typeof guildPatchSchema>;
