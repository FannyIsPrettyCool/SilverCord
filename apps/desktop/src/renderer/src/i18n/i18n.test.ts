import { describe, expect, it } from 'vitest';
import { detectLocale } from './i18n.ts';
import en from './locales/en.json';
import fr from './locales/fr.json';

function keys(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    keys(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe('locales', () => {
  it('have the same keys in English and French', () => {
    expect(keys(fr).sort()).toEqual(keys(en).sort());
  });

  it('have no empty strings', () => {
    for (const locale of [en, fr]) {
      const flat = JSON.stringify(locale);
      expect(flat).not.toContain('""');
    }
  });

  it('keep control labels within three words (BRIEF §7.8)', () => {
    // Longer strings must be listed in docs/spec/auth-screens.md and here.
    const specApproved = new Set([
      'register.age',
      'register.signIn',
      'forgot.sent',
      'forgot.back',
      'session.notRemembered',
      'code.useRecovery',
      'code.useApp',
      'signIn.login',
      // docs/spec/chat-screens.md
      'chat.historyVisible',
      'chat.typingMany',
      'social.cancel',
      'presence.dnd',
      'chat.deletedMessage',
      'chat.editConflict',
      // docs/spec/guild-screens.md (ICU count + unit)
      'guilds.memberCount',
    ]);
    const lookup = (key: string) =>
      key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], en);
    const labels = keys(en).filter(
      (key) =>
        !key.startsWith('errors.') &&
        !key.startsWith('chatErrors.') &&
        !key.startsWith('profileErrors.') &&
        // Tooltip copy listed in docs/spec/badges.md.
        !/^badges\.builtin\.\w+\.description$/.test(key) &&
        !key.startsWith('field.') &&
        !specApproved.has(key),
    );
    const tooLong = labels.filter((key) => String(lookup(key)).split(/\s+/).length > 3);
    expect(tooLong).toEqual([]);
  });

  it('picks the first supported OS language', () => {
    expect(detectLocale(['de-DE', 'fr-CA', 'en'])).toBe('fr');
    expect(detectLocale(['ja'])).toBe('en');
  });
});
