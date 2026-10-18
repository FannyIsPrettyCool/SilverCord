import { z } from 'zod';
import { cursorPageQuerySchema } from './pagination.ts';
import { snowflakeSchema } from './snowflake.ts';
import { publicUserSchema, usernameSchema } from './users.ts';

export const relationshipKindSchema = z.enum(['friends', 'incoming', 'outgoing', 'blocked']);
export type RelationshipKind = z.infer<typeof relationshipKindSchema>;
export const relationshipRequestSchema = z.strictObject({ username: usernameSchema });
export const relationshipUserParamsSchema = z.strictObject({ userId: snowflakeSchema });
export const relationshipListQuerySchema = cursorPageQuerySchema
  .safeExtend({ kind: relationshipKindSchema })
  .strict();
export type RelationshipListQuery = z.infer<typeof relationshipListQuerySchema>;

export const relationshipMetadataSchema = z.strictObject({
  nickname: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .refine((text) => !/[\p{Cc}\p{Cf}]/u.test(text))
    .nullable(),
  note: z
    .string()
    .max(1000)
    .refine((text) => !text.includes('\0'))
    .nullable(),
});
export type RelationshipMetadata = z.infer<typeof relationshipMetadataSchema>;
export const relationshipViewSchema = z.strictObject({
  id: snowflakeSchema,
  user: publicUserSchema,
  kind: relationshipKindSchema,
  version: z.number().int().positive(),
  metadata: relationshipMetadataSchema,
});
export type RelationshipView = z.infer<typeof relationshipViewSchema>;
export const relationshipPageSchema = z.strictObject({
  items: z.array(relationshipViewSchema),
  nextBefore: snowflakeSchema.nullable(),
});
export type RelationshipPage = z.infer<typeof relationshipPageSchema>;

export const friendRequestPolicySchema = z.enum(['everyone', 'nobody']);
export const directMessagePolicySchema = z.enum(['friends', 'nobody']);
export const socialPrivacySchema = z.strictObject({
  friendRequests: friendRequestPolicySchema,
  directMessages: directMessagePolicySchema,
  version: z.number().int().positive(),
});
export type SocialPrivacy = z.infer<typeof socialPrivacySchema>;
export const socialPrivacyPatchSchema = socialPrivacySchema
  .omit({ version: true })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, { message: 'provide a privacy setting' });
export type SocialPrivacyPatch = z.infer<typeof socialPrivacyPatchSchema>;
