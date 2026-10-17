import type { TFunction } from 'i18next';
import { DesktopError } from '../../desktop.ts';

const KNOWN = new Set([
  'INVALID_CREDENTIALS',
  'INVALID_TOTP',
  'RATE_LIMITED',
  'NETWORK',
  'CONFLICT',
  'INVITE_REQUIRED',
  'REGISTRATION_CLOSED',
  'TOKEN_INVALID',
] as const);

type KnownCode = typeof KNOWN extends Set<infer C> ? C : never;

/** Maps a failure to the copy in docs/spec/auth-screens.md. */
export function errorMessage(t: TFunction, error: unknown): string {
  const code = error instanceof DesktopError ? error.code : 'fallback';
  if (['TOKEN_EXPIRED', 'TOKEN_REUSED', 'UNAUTHENTICATED'].includes(code)) {
    return t('errors.TOKEN_INVALID');
  }
  return KNOWN.has(code as KnownCode) ? t(`errors.${code as KnownCode}`) : t('errors.fallback');
}
