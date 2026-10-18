import { z } from 'zod';
import { snowflakeSchema } from './snowflake.ts';

/** docs/spec/media.md. Limits mirror the server's validated env defaults. */
export const UPLOAD_MAX_BYTES_DEFAULT = 25 * 1024 * 1024;
export const UPLOAD_CHUNK_MAX_BYTES = 4 * 1024 * 1024;
export const ATTACHMENTS_PER_MESSAGE_MAX = 10;

/** `still` is the first frame of an animated profile image (ADR-0011); attachments never have one. */
export const mediaVariantSchema = z.enum(['display', 'thumbnail', 'download', 'still']);
export type MediaVariant = z.infer<typeof mediaVariantSchema>;

/** CDN path of one variant: `/media/:uploadId/:variant/:hash`. Requires a bearer token. */
export const MEDIA_PATH_PATTERN =
  /^\/media\/\d{1,19}\/(display|thumbnail|download|still)\/[a-f0-9]{64}$/;

export const uploadStateSchema = z.enum([
  'uploading',
  'processing',
  'ready',
  'attached',
  'failed',
  'deleting',
]);
export type UploadState = z.infer<typeof uploadStateSchema>;

export const uploadFailureSchema = z.enum([
  'UNSUPPORTED_TYPE',
  'TOO_LARGE',
  'MALFORMED',
  'LIMIT_EXCEEDED',
  'PROCESSING_FAILED',
]);
export type UploadFailure = z.infer<typeof uploadFailureSchema>;

/** Display name for a file; never used to build storage paths. */
export const uploadFilenameSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .refine((value) => !/[\p{Cc}\p{Cf}/\\]/u.test(value), { message: 'invalid characters' });

export const variantViewSchema = z.strictObject({
  variant: mediaVariantSchema,
  /** Path on the CDN origin: `/media/:uploadId/:variant/:hash`. Requires a bearer token. */
  path: z.string().regex(MEDIA_PATH_PATTERN),
  contentType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
});
export type VariantView = z.infer<typeof variantViewSchema>;

export const attachmentSchema = z.strictObject({
  id: snowflakeSchema,
  filename: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  /** Inline images/videos render from display/thumbnail; anything else is download-only. */
  kind: z.enum(['image', 'video', 'file']),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  blurhash: z.string().max(64).nullable(),
  animated: z.boolean(),
  variants: z.array(variantViewSchema),
});
export type Attachment = z.infer<typeof attachmentSchema>;

export const createUploadRequestSchema = z.strictObject({
  filename: uploadFilenameSchema,
  sizeBytes: z.number().int().positive(),
});
export type CreateUploadRequest = z.infer<typeof createUploadRequestSchema>;

export const uploadSchema = z.strictObject({
  id: snowflakeSchema,
  channelId: snowflakeSchema,
  filename: z.string(),
  sizeBytes: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
  chunkBytes: z.number().int().positive(),
  state: uploadStateSchema,
  failure: uploadFailureSchema.nullable(),
  expiresAt: z.iso.datetime(),
  attachment: attachmentSchema.nullable(),
});
export type Upload = z.infer<typeof uploadSchema>;

export const uploadParamsSchema = z.strictObject({ uploadId: snowflakeSchema });
export const uploadChunkHeadersSchema = z.object({
  'upload-offset': z.coerce.number().int().nonnegative(),
  'content-length': z.coerce.number().int().positive().max(UPLOAD_CHUNK_MAX_BYTES),
  'content-type': z.literal('application/octet-stream'),
});
export const uploadOffsetSchema = z.strictObject({ offset: z.number().int().nonnegative() });
