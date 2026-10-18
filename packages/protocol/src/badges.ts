import { z } from 'zod';
import { profileImageSchema } from './profile-media.ts';
import { snowflakeSchema } from './snowflake.ts';
import { usernameSchema } from './users.ts';

/** docs/spec/badges.md */
export const BADGE_RARITIES = [
  'common',
  'uncommon',
  'rare',
  'epic',
  'legendary',
  'mythic',
] as const;
export const badgeRaritySchema = z.enum(BADGE_RARITIES);
export type BadgeRarity = z.infer<typeof badgeRaritySchema>;

export const BUILTIN_BADGES = [
  'founder',
  'early_member',
  'anniversary',
  'instance_admin',
  'server_owner',
  'verified',
  'secured',
] as const;
export const builtinBadgeSchema = z.enum(BUILTIN_BADGES);
export type BuiltinBadge = z.infer<typeof builtinBadgeSchema>;

/** Icons bundled with the desktop (Phosphor names); admins pick one or upload an image. */
export const BADGE_ICONS = [
  'sparkle',
  'crown',
  'star',
  'heart',
  'lightning',
  'shield-check',
  'seal-check',
  'cake',
  'flag',
  'trophy',
  'medal',
  'rocket',
  'flower',
  'moon',
  'sun',
  'fire',
  'code',
  'paint-brush',
  'music-notes',
  'game-controller',
  'lock-key',
  'diamond',
  'ghost',
  'planet',
] as const;
export const badgeIconNameSchema = z.enum(BADGE_ICONS);
export type BadgeIconName = z.infer<typeof badgeIconNameSchema>;

export const BADGE_PINS_MAX = 6;
export const BADGE_DEFINITIONS_MAX = 200;

export const badgeIconSchema = z.union([
  z.strictObject({ kind: z.literal('icon'), name: badgeIconNameSchema }),
  z.strictObject({ kind: z.literal('image'), image: profileImageSchema }),
]);
export type BadgeIcon = z.infer<typeof badgeIconSchema>;

export const badgeDefinitionSchema = z.strictObject({
  id: snowflakeSchema,
  /** Built-in key: clients localize name and description by it. */
  key: builtinBadgeSchema.nullable(),
  name: z.string(),
  description: z.string(),
  rarity: badgeRaritySchema,
  icon: badgeIconSchema,
  retired: z.boolean(),
});
export type BadgeDefinition = z.infer<typeof badgeDefinitionSchema>;
export const badgeDefinitionListSchema = z.strictObject({
  items: z.array(badgeDefinitionSchema),
});

export const badgeAwardSchema = z.strictObject({
  badge: badgeDefinitionSchema,
  level: z.number().int().positive(),
  awardedAt: z.iso.datetime(),
  pin: z
    .number()
    .int()
    .min(0)
    .max(BADGE_PINS_MAX - 1)
    .nullable(),
});
export type BadgeAward = z.infer<typeof badgeAwardSchema>;
export const badgeAwardListSchema = z.strictObject({ items: z.array(badgeAwardSchema) });

export const badgePinsRequestSchema = z.strictObject({
  badgeIds: z
    .array(snowflakeSchema)
    .max(BADGE_PINS_MAX)
    .refine((ids) => new Set(ids).size === ids.length, { message: 'ids must be unique' }),
});

const badgeNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value), { message: 'invalid characters' });
const badgeDescriptionSchema = z
  .string()
  .trim()
  .max(140)
  .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value), { message: 'invalid characters' });

/** Exactly one of a bundled icon or a processed `badge_icon` upload. */
const iconChoice = {
  iconName: badgeIconNameSchema.optional(),
  iconUploadId: snowflakeSchema.optional(),
};

export const createBadgeRequestSchema = z
  .strictObject({
    name: badgeNameSchema,
    description: badgeDescriptionSchema,
    rarity: badgeRaritySchema,
    ...iconChoice,
  })
  .refine((value) => (value.iconName === undefined) !== (value.iconUploadId === undefined), {
    message: 'choose an icon or an uploaded image',
    path: ['iconName'],
  });
export type CreateBadgeRequest = z.infer<typeof createBadgeRequestSchema>;

export const badgePatchSchema = z
  .strictObject({
    name: badgeNameSchema.optional(),
    description: badgeDescriptionSchema.optional(),
    rarity: badgeRaritySchema.optional(),
    retired: z.boolean().optional(),
    ...iconChoice,
  })
  .refine((value) => value.iconName === undefined || value.iconUploadId === undefined, {
    message: 'choose an icon or an uploaded image',
    path: ['iconName'],
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'provide a field' });
export type BadgePatch = z.infer<typeof badgePatchSchema>;

export const awardBadgeRequestSchema = z.strictObject({
  username: usernameSchema,
  reason: badgeDescriptionSchema.nullable().optional(),
});
export const badgeParamsSchema = z.strictObject({ badgeId: snowflakeSchema });
export const badgeAwardParamsSchema = z.strictObject({
  badgeId: snowflakeSchema,
  userId: snowflakeSchema,
});
