import { describe, expect, it } from 'vitest';
import { isTrustedSender } from './trusted-sender.ts';

describe('isTrustedSender', () => {
  it('accepts only the top-level app frame', () => {
    expect(isTrustedSender({ senderFrame: { origin: 'app://bundle', parent: null } })).toBe(true);
    expect(isTrustedSender({ senderFrame: { origin: 'app://bundle', parent: {} } })).toBe(false);
    expect(isTrustedSender({ senderFrame: { origin: 'https://evil.example', parent: null } })).toBe(
      false,
    );
    expect(isTrustedSender({ senderFrame: { origin: 'null', parent: null } })).toBe(false);
    expect(isTrustedSender({ senderFrame: null })).toBe(false);
  });
});
