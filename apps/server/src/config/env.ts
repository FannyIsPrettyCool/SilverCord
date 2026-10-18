import { z } from 'zod';

/**
 * Development-only secrets so a fresh clone boots without setup. Production refuses to start
 * while any of these is still in use.
 */
const DEV_SECRETS = {
  JWT_SECRET: 'dev-only-jwt-secret-change-me-0123456789abcdef',
  TOTP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
} as const;

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', '::1', 'localhost']);

const base64Key32 = z.base64().refine((value) => Buffer.from(value, 'base64').length === 32, {
  message: 'must be 32 bytes, base64-encoded',
});

const booleanFlag = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().min(1).default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    /** Set to true only behind Caddy so `request.ip` reflects the real client. */
    TRUST_PROXY: booleanFlag,
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    /** Snowflake worker id; unique per running API/worker process. */
    WORKER_ID: z.coerce.number().int().min(0).max(1023).default(0),
    DATABASE_URL: z
      .url({ protocol: /^postgres(ql)?$/ })
      .default('postgres://silvercord:silvercord@localhost:5432/silvercord'),
    VALKEY_URL: z.url({ protocol: /^rediss?$/ }).default('redis://localhost:6379'),
    JWT_SECRET: z.string().min(32).default(DEV_SECRETS.JWT_SECRET),
    TOTP_ENCRYPTION_KEY: base64Key32.default(DEV_SECRETS.TOTP_ENCRYPTION_KEY),
    SMTP_URL: z.url({ protocol: /^smtps?$/ }).default('smtp://localhost:1025'),
    MAIL_FROM: z.string().min(3).default('SilverCord <no-reply@silvercord.localhost>'),
    /**
     * Comma-separated browser origins allowed to call the API: the packaged desktop renderer
     * (`app://bundle`) and, in development, the Vite dev server.
     */
    CORS_ORIGINS: z
      .string()
      .default('app://bundle,http://localhost:5173')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      ),
    /** Maximum members of a group DM, including its owner. */
    GROUP_DM_MAX_MEMBERS: z.coerce.number().int().min(3).max(25).default(10),
    /** Local storage root for uploads and variants (ADR-0009). */
    MEDIA_STORAGE_DIR: z.string().min(1).default('.data/media'),
    /** Shared with the media-decoder container in production. */
    MEDIA_JOBS_DIR: z.string().min(1).default('.data/media-jobs'),
    /** `container`: a network-less decoder container processes jobs; `local`: child process. */
    MEDIA_DECODER: z.enum(['local', 'container']).default('local'),
    MEDIA_MAX_FILE_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(25 * 1024 * 1024),
    MEDIA_USER_QUOTA_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(512 * 1024 * 1024),
    MEDIA_INSTANCE_QUOTA_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(20 * 1024 * 1024 * 1024),
    MEDIA_CONCURRENT_UPLOADS: z.coerce.number().int().min(1).max(20).default(3),
    MEDIA_UPLOAD_TTL_SECONDS: z.coerce.number().int().min(60).default(3600),
    /** Optional k-anonymity check against Have I Been Pwned; calls an external service. */
    HIBP_ENABLED: booleanFlag,
  })
  .superRefine((env, context) => {
    // Public dev secrets are tolerated only on a loopback-bound, non-production server, so a
    // forgotten NODE_ENV on a VPS can't boot with a JWT key anyone can read in the repo.
    const loopback = LOOPBACK_HOSTS.has(env.HOST);
    if (env.NODE_ENV !== 'production' && loopback) return;
    for (const [key, devValue] of Object.entries(DEV_SECRETS)) {
      if (env[key as keyof typeof DEV_SECRETS] === devValue) {
        context.addIssue({
          code: 'custom',
          path: [key],
          message: loopback
            ? 'development secret in production'
            : 'development secret on a non-loopback HOST',
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

export class InvalidConfigError extends Error {
  readonly code = 'INVALID_CONFIG';
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid configuration:\n  ${issues.join('\n  ')}`);
    this.name = 'InvalidConfigError';
    this.issues = issues;
  }
}

/** Parses process environment; the server refuses to boot on invalid config (BRIEF §5.1). */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new InvalidConfigError(
      result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    );
  }
  return result.data;
}
