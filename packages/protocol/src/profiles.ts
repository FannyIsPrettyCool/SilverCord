import { z } from 'zod';
import { badgeAwardSchema } from './badges.ts';
import { profileImageSchema } from './profile-media.ts';
import { relationshipKindSchema } from './relationships.ts';
import { snowflakeSchema } from './snowflake.ts';
import { displayNameSchema } from './users.ts';

/** docs/spec/profiles.md. Widest to narrowest; `mutual_guilds` includes friends. */
export const profileAudienceSchema = z.enum(['everyone', 'mutual_guilds', 'friends', 'only_me']);
export type ProfileAudience = z.infer<typeof profileAudienceSchema>;

export const PROFILE_SECTIONS = [
  'bio',
  'pronouns',
  'banner',
  'badges',
  'memberSince',
  'customStatus',
  'activity',
  'mutualFriends',
  'mutualGuilds',
] as const;
export type ProfileSection = (typeof PROFILE_SECTIONS)[number];

export const profilePrivacySchema = z.strictObject({
  bio: profileAudienceSchema,
  pronouns: profileAudienceSchema,
  banner: profileAudienceSchema,
  badges: profileAudienceSchema,
  memberSince: profileAudienceSchema,
  customStatus: profileAudienceSchema,
  activity: profileAudienceSchema,
  mutualFriends: profileAudienceSchema,
  mutualGuilds: profileAudienceSchema,
});
export type ProfilePrivacy = z.infer<typeof profilePrivacySchema>;

export const DEFAULT_PROFILE_PRIVACY: ProfilePrivacy = {
  bio: 'everyone',
  pronouns: 'everyone',
  banner: 'everyone',
  badges: 'everyone',
  memberSince: 'everyone',
  customStatus: 'everyone',
  activity: 'mutual_guilds',
  mutualFriends: 'mutual_guilds',
  mutualGuilds: 'mutual_guilds',
};

export const BIO_MAX = 400;
export const BIO_MAX_LINES = 12;
export const PRONOUNS_MAX = 40;
export const CUSTOM_STATUS_MAX = 128;
export const MUTUALS_MAX = 100;
export const SUMMARIES_MAX_IDS = 100;

const codePoints = (value: string) => [...value].length;
/** Control and invisible formatting characters spoof or garble names; newlines only in bios. */
const noControls = (value: string) => !/[\p{Cc}\p{Cf}]/u.test(value);

export const bioSchema = z
  .string()
  .transform((value) => value.replace(/\r\n?/g, '\n').trim())
  .refine((value) => codePoints(value) <= BIO_MAX, { message: `at most ${BIO_MAX} characters` })
  .refine((value) => value.split('\n').length <= BIO_MAX_LINES, {
    message: `at most ${BIO_MAX_LINES} lines`,
  })
  .refine((value) => !/\p{Cf}/u.test(value) && !/\p{Cc}/u.test(value.replaceAll('\n', '')), {
    message: 'invalid characters',
  });

export const pronounsSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => codePoints(value) <= PRONOUNS_MAX, { message: 'too long' })
  .refine(noControls, { message: 'invalid characters' });

export const colorSchema = z.number().int().min(0).max(0xffffff);

const EMOJI_START = String.raw`(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[#*0-9]️?⃣)`;
const EMOJI_PART = String.raw`(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|‍|️|[\u{E0020}-\u{E007F}])`;
const EMOJI_SEQUENCE = new RegExp(`^${EMOJI_START}${EMOJI_PART}*$`, 'u');

/** One unicode emoji (any sequence of pictographs/joiners/modifiers) or a custom emote. */
export const statusEmojiSchema = z
  .string()
  .max(64)
  .refine((value) => /^custom:\d{1,19}$/.test(value) || EMOJI_SEQUENCE.test(value), {
    message: 'one emoji',
  });

export const customStatusSchema = z.strictObject({
  text: z.string().max(CUSTOM_STATUS_MAX).nullable(),
  emoji: statusEmojiSchema.nullable(),
  expiresAt: z.iso.datetime().nullable(),
});
export type CustomStatus = z.infer<typeof customStatusSchema>;

export const customStatusRequestSchema = z
  .strictObject({
    text: z
      .string()
      .trim()
      .max(CUSTOM_STATUS_MAX)
      .refine(noControls, { message: 'invalid characters' })
      .nullable(),
    emoji: statusEmojiSchema.nullable(),
    expiresAt: z.iso.datetime().nullable(),
  })
  .refine((value) => (value.text !== null && value.text.length > 0) || value.emoji !== null, {
    message: 'provide text or an emoji',
  });
export type CustomStatusRequest = z.infer<typeof customStatusRequestSchema>;

export const themeColorsSchema = z.tuple([colorSchema, colorSchema]);

export const ownProfileSchema = z.strictObject({
  userId: snowflakeSchema,
  username: z.string(),
  displayName: z.string().nullable(),
  bio: z.string().nullable(),
  pronouns: z.string().nullable(),
  accentColor: colorSchema.nullable(),
  bannerColor: colorSchema.nullable(),
  themeColors: themeColorsSchema.nullable(),
  avatar: profileImageSchema.nullable(),
  banner: profileImageSchema.nullable(),
  customStatus: customStatusSchema.nullable(),
  privacy: profilePrivacySchema,
  version: z.number().int().positive(),
  memberSince: z.iso.datetime(),
});
export type OwnProfile = z.infer<typeof ownProfileSchema>;

export const profilePatchSchema = z
  .strictObject({
    version: z.number().int().positive(),
    displayName: displayNameSchema.nullable().optional(),
    bio: bioSchema.nullable().optional(),
    pronouns: pronounsSchema.nullable().optional(),
    accentColor: colorSchema.nullable().optional(),
    bannerColor: colorSchema.nullable().optional(),
    themeColors: themeColorsSchema.nullable().optional(),
    avatarUploadId: snowflakeSchema.nullable().optional(),
    bannerUploadId: snowflakeSchema.nullable().optional(),
  })
  .refine((patch) => Object.keys(patch).length > 1, { message: 'provide a profile field' });
export type ProfilePatch = z.infer<typeof profilePatchSchema>;

export const mutualsSchema = z.strictObject({
  count: z.number().int().nonnegative(),
  ids: z.array(snowflakeSchema).max(MUTUALS_MAX),
});

export const profileRelationshipSchema = z.union([relationshipKindSchema, z.literal('none')]);

export const guildMemberCardSchema = z.strictObject({
  guildId: snowflakeSchema,
  nickname: z.string().nullable(),
  joinedAt: z.iso.datetime(),
  roleIds: z.array(snowflakeSchema),
});

/**
 * What a viewer may see (docs/spec/profiles.md): hidden sections are absent, never marked,
 * so "not set" and "not shared" look the same.
 */
export const userProfileSchema = z.strictObject({
  userId: snowflakeSchema,
  username: z.string(),
  displayName: z.string().nullable(),
  avatar: profileImageSchema.nullable(),
  accentColor: colorSchema.nullable(),
  bannerColor: colorSchema.nullable(),
  themeColors: themeColorsSchema.nullable(),
  banner: profileImageSchema.nullable().optional(),
  bio: z.string().nullable().optional(),
  pronouns: z.string().nullable().optional(),
  customStatus: customStatusSchema.nullable().optional(),
  memberSince: z.iso.datetime().optional(),
  /** Pinned first, then rarest, then newest. */
  badges: z.array(badgeAwardSchema).optional(),
  mutualFriends: mutualsSchema.optional(),
  mutualGuilds: mutualsSchema.optional(),
  relationship: profileRelationshipSchema,
  /** The viewer's own private note about this user. */
  note: z.string().nullable(),
  guildMember: guildMemberCardSchema.optional(),
});
export type UserProfile = z.infer<typeof userProfileSchema>;

export const profileParamsSchema = z.strictObject({ userId: snowflakeSchema });
export const profileQuerySchema = z.strictObject({ guildId: snowflakeSchema.optional() });

export const summariesQuerySchema = z.strictObject({
  userIds: z
    .string()
    .max(2000)
    .transform((value) => value.split(','))
    .pipe(
      z
        .array(snowflakeSchema)
        .min(1)
        .max(SUMMARIES_MAX_IDS)
        .refine((ids) => new Set(ids).size === ids.length, { message: 'ids must be unique' }),
    ),
  guildId: snowflakeSchema.optional(),
});

/** Card data for lists and messages; batch-loaded like presence. */
export const userSummarySchema = z.strictObject({
  userId: snowflakeSchema,
  avatar: profileImageSchema.nullable(),
  accentColor: colorSchema.nullable(),
  /** Guild context only: the member's nickname there. */
  nickname: z.string().nullable().optional(),
  customStatus: customStatusSchema.nullable().optional(),
});
export type UserSummary = z.infer<typeof userSummarySchema>;
export const userSummariesSchema = z.strictObject({ items: z.array(userSummarySchema) });

export const guildMemberProfileSchema = z.strictObject({
  guildId: snowflakeSchema,
  nickname: z.string().nullable(),
  avatar: profileImageSchema.nullable(),
  banner: profileImageSchema.nullable(),
  bio: z.string().nullable(),
  pronouns: z.string().nullable(),
  accentColor: colorSchema.nullable(),
});
export type GuildMemberProfile = z.infer<typeof guildMemberProfileSchema>;

export const guildMemberProfilePatchSchema = z
  .strictObject({
    nickname: displayNameSchema.nullable().optional(),
    avatarUploadId: snowflakeSchema.nullable().optional(),
    bannerUploadId: snowflakeSchema.nullable().optional(),
    bio: bioSchema.nullable().optional(),
    pronouns: pronounsSchema.nullable().optional(),
    accentColor: colorSchema.nullable().optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, { message: 'provide a profile field' });
export type GuildMemberProfilePatch = z.infer<typeof guildMemberProfilePatchSchema>;

export const profileChangedSchema = z.strictObject({ userId: snowflakeSchema });
