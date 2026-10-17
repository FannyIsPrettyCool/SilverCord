import { GITMOJI, MAX_SUBJECT_LENGTH, SCOPES } from './gitmoji.ts';

const VARIATION_SELECTOR = /️/g;
const HEADER_PATTERN = /^(?<emoji>\S+) (?<scope>[a-z0-9-]+): (?<subject>.+)$/u;

const gitmojiSet: ReadonlySet<string> = new Set(GITMOJI);
const scopeSet: ReadonlySet<string> = new Set(SCOPES);

export type HeaderCheck = { ok: true } | { ok: false; reason: string };

/** Validates a commit header against `<gitmoji> <scope>: <subject>`. */
export function checkHeader(header: string): HeaderCheck {
  const match = HEADER_PATTERN.exec(header);
  const groups = match?.groups;
  if (!groups) {
    return { ok: false, reason: 'header must match "<gitmoji> <scope>: <subject>"' };
  }
  const emoji = groups['emoji'] ?? '';
  const scope = groups['scope'] ?? '';
  const subject = groups['subject'] ?? '';

  if (emoji.startsWith(':')) {
    return { ok: false, reason: 'use the unicode gitmoji, not a :shortcode:' };
  }
  if (!gitmojiSet.has(emoji.replace(VARIATION_SELECTOR, ''))) {
    return { ok: false, reason: `"${emoji}" is not an allowed gitmoji (docs/BRIEF.md §12.2)` };
  }
  if (emoji.replace(VARIATION_SELECTOR, '') === '🚧') {
    return { ok: false, reason: '🚧 is not allowed' };
  }
  if (!scopeSet.has(scope)) {
    return { ok: false, reason: `scope "${scope}" not allowed; use one of: ${SCOPES.join(' ')}` };
  }
  if ([...subject].length > MAX_SUBJECT_LENGTH) {
    return { ok: false, reason: `subject longer than ${MAX_SUBJECT_LENGTH} characters` };
  }
  if (subject.endsWith('.')) {
    return { ok: false, reason: 'subject must not end with a period' };
  }
  if (subject !== subject.trim()) {
    return { ok: false, reason: 'subject must not have leading or trailing whitespace' };
  }
  if (/^[A-Z][a-z]/.test(subject)) {
    return { ok: false, reason: 'subject must start lowercase (imperative mood)' };
  }
  return { ok: true };
}
