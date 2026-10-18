import { z } from 'zod';
import {
  MEDIA_PATH_PATTERN,
  uploadFailureSchema,
  uploadFilenameSchema,
  uploadStateSchema,
} from './media.ts';
import { snowflakeSchema } from './snowflake.ts';

/** ADR-0011: uploads that belong to an account, a guild or the instance rather than a channel. */
export const profileMediaPurposeSchema = z.enum([
  'avatar',
  'banner',
  'guild_avatar',
  'guild_banner',
  'emote',
  'sticker',
  'badge_icon',
]);
export type ProfileMediaPurpose = z.infer<typeof profileMediaPurposeSchema>;

export const GUILD_MEDIA_PURPOSES: ReadonlySet<ProfileMediaPurpose> = new Set([
  'guild_avatar',
  'guild_banner',
  'emote',
  'sticker',
]);

interface PurposeShape {
  readonly maxBytes: number;
  /** Output aspect (width / height) when the image is cropped to a fixed frame. */
  readonly aspect: number | null;
  readonly display: { readonly width: number; readonly height: number };
  readonly thumbnail: { readonly width: number; readonly height: number };
}

const MiB = 1024 * 1024;
/** Fixed frames are covered exactly; free-form purposes fit inside the box. */
export const PROFILE_MEDIA_SHAPES: Readonly<Record<ProfileMediaPurpose, PurposeShape>> = {
  avatar: {
    maxBytes: 10 * MiB,
    aspect: 1,
    display: { width: 512, height: 512 },
    thumbnail: { width: 128, height: 128 },
  },
  guild_avatar: {
    maxBytes: 10 * MiB,
    aspect: 1,
    display: { width: 512, height: 512 },
    thumbnail: { width: 128, height: 128 },
  },
  banner: {
    maxBytes: 10 * MiB,
    aspect: 5 / 2,
    display: { width: 1500, height: 600 },
    thumbnail: { width: 600, height: 240 },
  },
  guild_banner: {
    maxBytes: 10 * MiB,
    aspect: 5 / 2,
    display: { width: 1500, height: 600 },
    thumbnail: { width: 600, height: 240 },
  },
  emote: {
    maxBytes: 512 * 1024,
    aspect: null,
    display: { width: 128, height: 128 },
    thumbnail: { width: 48, height: 48 },
  },
  sticker: {
    maxBytes: 1 * MiB,
    aspect: null,
    display: { width: 320, height: 320 },
    thumbnail: { width: 160, height: 160 },
  },
  badge_icon: {
    maxBytes: 256 * 1024,
    aspect: null,
    display: { width: 128, height: 128 },
    thumbnail: { width: 48, height: 48 },
  },
};

/** Source-pixel rectangle applied before resizing (to every frame of an animation). */
export const cropSchema = z.strictObject({
  x: z.number().int().nonnegative().max(8191),
  y: z.number().int().nonnegative().max(8191),
  width: z.number().int().min(16).max(8192),
  height: z.number().int().min(16).max(8192),
});
export type Crop = z.infer<typeof cropSchema>;

export const createProfileUploadRequestSchema = z
  .strictObject({
    purpose: profileMediaPurposeSchema,
    filename: uploadFilenameSchema,
    sizeBytes: z.number().int().positive(),
    guildId: snowflakeSchema.optional(),
  })
  .refine((value) => GUILD_MEDIA_PURPOSES.has(value.purpose) === (value.guildId !== undefined), {
    message: 'guildId is required exactly for guild purposes',
    path: ['guildId'],
  })
  .refine((value) => value.sizeBytes <= PROFILE_MEDIA_SHAPES[value.purpose].maxBytes, {
    message: 'file too large for this purpose',
    path: ['sizeBytes'],
  });
export type CreateProfileUploadRequest = z.infer<typeof createProfileUploadRequestSchema>;

export const completeUploadRequestSchema = z.strictObject({ crop: cropSchema.optional() });
export type CompleteUploadRequest = z.infer<typeof completeUploadRequestSchema>;

const imagePathSchema = z.string().regex(MEDIA_PATH_PATTERN);

/** A processed avatar, banner, emote, sticker or badge icon. */
export const profileImageSchema = z.strictObject({
  uploadId: snowflakeSchema,
  display: imagePathSchema,
  thumbnail: imagePathSchema,
  /** First frame, present for animated images only. */
  still: imagePathSchema.nullable(),
  animated: z.boolean(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  dominantColor: z.number().int().min(0).max(0xffffff).nullable(),
});
export type ProfileImage = z.infer<typeof profileImageSchema>;

export const profileUploadSchema = z.strictObject({
  id: snowflakeSchema,
  purpose: profileMediaPurposeSchema,
  guildId: snowflakeSchema.nullable(),
  filename: z.string(),
  sizeBytes: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
  chunkBytes: z.number().int().positive(),
  state: uploadStateSchema,
  failure: uploadFailureSchema.nullable(),
  expiresAt: z.iso.datetime(),
  image: profileImageSchema.nullable(),
});
export type ProfileUpload = z.infer<typeof profileUploadSchema>;
