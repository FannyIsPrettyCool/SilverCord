import type { ErrorCode } from '@silvercord/protocol';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  REGISTRATION_CLOSED: 403,
  INVITE_REQUIRED: 403,
  INVALID_CREDENTIALS: 401,
  TOTP_REQUIRED: 401,
  INVALID_TOTP: 401,
  EMAIL_NOT_VERIFIED: 403,
  TOKEN_EXPIRED: 401,
  TOKEN_INVALID: 401,
  TOKEN_REUSED: 401,
};

export interface AppErrorOptions {
  readonly retryAfterSeconds?: number;
  /** Request field the error is about, surfaced as `issues[0].path` (e.g. a taken email). */
  readonly field?: string;
  readonly cause?: unknown;
}

/**
 * Domain error with a machine code. Services throw these; the HTTP error handler turns them into
 * the shared error envelope. The message is sent to clients, so it must never contain internals.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly retryAfterSeconds: number | undefined;
  readonly field: string | undefined;

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.statusCode = STATUS_BY_CODE[code];
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.field = options.field;
  }
}
