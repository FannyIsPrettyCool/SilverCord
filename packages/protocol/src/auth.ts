import { z } from 'zod';
import { snowflakeSchema } from './snowflake.ts';
import { currentUserSchema, displayNameSchema, localeSchema, usernameSchema } from './users.ts';

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 256;

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN)
  .max(PASSWORD_MAX)
  .transform((value) => value.normalize('NFKC'));

export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());

export const deviceNameSchema = z.string().trim().min(1).max(64);

export const registerRequestSchema = z.object({
  email: emailSchema,
  username: usernameSchema,
  password: passwordSchema,
  displayName: displayNameSchema.optional(),
  inviteCode: z.string().trim().min(1).max(64).optional(),
  ageConfirmed: z.literal(true),
  locale: localeSchema,
  deviceName: deviceNameSchema,
});
export type RegisterRequest = z.input<typeof registerRequestSchema>;

export const loginRequestSchema = z.object({
  /** Email or username. */
  login: z.string().trim().toLowerCase().min(1).max(254),
  // Same normalisation as passwordSchema, or non-NFKC passwords could never match their hash.
  password: z
    .string()
    .min(1)
    .max(PASSWORD_MAX)
    .transform((value) => value.normalize('NFKC')),
  deviceName: deviceNameSchema,
});
export type LoginRequest = z.input<typeof loginRequestSchema>;

export const totpCodeSchema = z.string().regex(/^\d{6}$/, 'must be 6 digits');
export const recoveryCodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]{5}-?[a-z0-9]{5}$/, 'invalid recovery code')
  .transform((value) => value.replace('-', ''));

export const loginTotpRequestSchema = z.union([
  z.object({ ticket: z.string().min(1).max(2048), code: totpCodeSchema }),
  z.object({ ticket: z.string().min(1).max(2048), recoveryCode: recoveryCodeSchema }),
]);
export type LoginTotpRequest = z.input<typeof loginTotpRequestSchema>;

export const refreshRequestSchema = z.object({
  refreshToken: z.string().min(1).max(256),
});

export const authTokensSchema = z.object({
  accessToken: z.string(),
  accessTokenExpiresAt: z.iso.datetime(),
  refreshToken: z.string(),
  user: currentUserSchema,
});
export type AuthTokens = z.infer<typeof authTokensSchema>;

export const mfaChallengeSchema = z.object({
  mfaRequired: z.literal(true),
  ticket: z.string(),
});
export type MfaChallenge = z.infer<typeof mfaChallengeSchema>;

export const loginResponseSchema = z.union([authTokensSchema, mfaChallengeSchema]);
export type LoginResponse = z.infer<typeof loginResponseSchema>;

export const sessionSchema = z.object({
  id: snowflakeSchema,
  deviceName: z.string(),
  userAgent: z.string().nullable(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime(),
  current: z.boolean(),
});
export type Session = z.infer<typeof sessionSchema>;

export const emailTokenRequestSchema = z.object({ token: z.string().min(1).max(256) });
export const forgotPasswordRequestSchema = z.object({ email: emailSchema });
export const resetPasswordRequestSchema = z.object({
  token: z.string().min(1).max(256),
  password: passwordSchema,
});

export const totpSetupResponseSchema = z.object({ secret: z.string(), otpauthUri: z.string() });
export const totpEnableRequestSchema = z.object({ code: totpCodeSchema });
export const totpEnableResponseSchema = z.object({ recoveryCodes: z.array(z.string()) });
export const totpDisableRequestSchema = z.object({
  // Same normalisation as passwordSchema, or non-NFKC passwords could never match their hash.
  password: z
    .string()
    .min(1)
    .max(PASSWORD_MAX)
    .transform((value) => value.normalize('NFKC')),
  code: totpCodeSchema,
});

export const registrationModeSchema = z.enum(['open', 'invite_only', 'closed']);
export type RegistrationMode = z.infer<typeof registrationModeSchema>;

export const createInstanceInviteRequestSchema = z.object({
  maxUses: z.number().int().min(1).max(1000).default(1),
  expiresInHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 90)
    .default(24 * 7),
});
export const instanceInviteSchema = z.object({
  id: snowflakeSchema,
  code: z.string(),
  maxUses: z.number().int(),
  uses: z.number().int(),
  expiresAt: z.iso.datetime(),
});
export type InstanceInvite = z.infer<typeof instanceInviteSchema>;
