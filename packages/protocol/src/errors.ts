import { z } from 'zod';

/** Machine-readable error codes shared by REST and the gateway. Append only; never repurpose. */
export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'PAYLOAD_TOO_LARGE',
  'INTERNAL',
  'REGISTRATION_CLOSED',
  'INVITE_REQUIRED',
  'INVALID_CREDENTIALS',
  'TOTP_REQUIRED',
  'INVALID_TOTP',
  'EMAIL_NOT_VERIFIED',
  'TOKEN_EXPIRED',
  'TOKEN_INVALID',
  'TOKEN_REUSED',
] as const;

export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const fieldIssueSchema = z.object({
  path: z.string(),
  message: z.string(),
});

/** Every non-2xx REST response body (BRIEF §5.1). */
export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    requestId: z.string().optional(),
    issues: z.array(fieldIssueSchema).optional(),
    retryAfterSeconds: z.number().int().nonnegative().optional(),
  }),
});

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;
