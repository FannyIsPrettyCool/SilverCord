import { z } from 'zod';

/** docs/spec/activity.md */
export const activityTypeSchema = z.enum([
  'playing',
  'listening',
  'watching',
  'streaming',
  'competing',
]);
export type ActivityType = z.infer<typeof activityTypeSchema>;

export const ACTIVITY_SOURCES = ['manual', 'game', 'rpc', 'media'] as const;
export const activitySourceSchema = z.enum(ACTIVITY_SOURCES);
export type ActivitySource = z.infer<typeof activitySourceSchema>;
/** Sources the desktop detects and re-sends while they last. */
export const detectedSourceSchema = z.enum(['game', 'rpc', 'media']);
export type DetectedSource = z.infer<typeof detectedSourceSchema>;

export const ACTIVITY_TEXT_MAX = 128;
export const ACTIVITY_REFRESH_MS = 60_000;
export const ACTIVITY_STALE_MS = 150_000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const plain = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value), { message: 'invalid characters' });

const nearNow = z.iso
  .datetime()
  .refine((value) => Math.abs(Date.parse(value) - Date.now()) <= WEEK_MS, {
    message: 'must be within a week of now',
  });

export const activityButtonSchema = z.strictObject({
  label: plain(32),
  url: z.url({ protocol: /^https$/ }).max(512),
});

/** What a source reports. Unknown keys from RPC clients are stripped before this parse. */
export const activityInputSchema = z
  .strictObject({
    type: activityTypeSchema,
    name: plain(ACTIVITY_TEXT_MAX),
    details: plain(ACTIVITY_TEXT_MAX).nullable().optional(),
    state: plain(ACTIVITY_TEXT_MAX).nullable().optional(),
    startedAt: nearNow.nullable().optional(),
    endsAt: nearNow.nullable().optional(),
    buttons: z.array(activityButtonSchema).max(2).optional(),
    application: plain(64).nullable().optional(),
  })
  .refine(
    (value) =>
      !value.startedAt || !value.endsAt || Date.parse(value.endsAt) > Date.parse(value.startedAt),
    { message: 'endsAt must follow startedAt', path: ['endsAt'] },
  );
export type ActivityInput = z.infer<typeof activityInputSchema>;

export const activitySchema = z.strictObject({
  source: activitySourceSchema,
  type: activityTypeSchema,
  name: z.string(),
  details: z.string().nullable(),
  state: z.string().nullable(),
  startedAt: z.iso.datetime().nullable(),
  endsAt: z.iso.datetime().nullable(),
  buttons: z.array(z.strictObject({ label: z.string(), url: z.string() })),
  application: z.string().nullable(),
});
export type Activity = z.infer<typeof activitySchema>;

export const activitySourcesSchema = z.strictObject({
  manual: z.boolean(),
  game: z.boolean(),
  rpc: z.boolean(),
  media: z.boolean(),
});
export type ActivitySources = z.infer<typeof activitySourcesSchema>;
export const DEFAULT_ACTIVITY_SOURCES: ActivitySources = {
  manual: false,
  game: false,
  rpc: false,
  media: false,
};

export const ownActivitySchema = z.strictObject({
  sources: activitySourcesSchema,
  manual: z
    .strictObject({ activity: activitySchema, expiresAt: z.iso.datetime().nullable() })
    .nullable(),
  activities: z.array(activitySchema).max(4),
});
export type OwnActivity = z.infer<typeof ownActivitySchema>;

export const setActivityRequestSchema = z.strictObject({
  activity: activityInputSchema,
  /** Manual activity only: when it clears itself. */
  expiresAt: z.iso.datetime().nullable().optional(),
});
export type SetActivityRequest = z.infer<typeof setActivityRequestSchema>;
export const activityParamsSchema = z.strictObject({ source: activitySourceSchema });
