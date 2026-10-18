import { DesktopError } from '../../desktop.ts';

const KNOWN = [
  'NOT_FOUND',
  'FORBIDDEN',
  'CONFLICT',
  'RATE_LIMITED',
  'NETWORK',
  'PAYLOAD_TOO_LARGE',
  'VALIDATION_FAILED',
] as const;
type ChatErrorCode = (typeof KNOWN)[number] | 'fallback';

const isKnown = (code: string): code is (typeof KNOWN)[number] =>
  (KNOWN as readonly string[]).includes(code);

/** Chat error copy keyed by machine code (docs/spec/chat-screens.md). */
export function errorKey(error: unknown): `chatErrors.${ChatErrorCode}` {
  const code = error instanceof DesktopError && isKnown(error.code) ? error.code : 'fallback';
  return `chatErrors.${code}`;
}
