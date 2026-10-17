import i18next from 'i18next';
import { describe, expect, it } from 'vitest';
import { DesktopError } from '../../desktop.ts';
import en from '../../i18n/locales/en.json';
import fr from '../../i18n/locales/fr.json';
import { errorMessage } from './error-message.ts';

describe('auth error copy', () => {
  it.each(['en', 'fr'])(
    'explains expired sessions in %s for every terminal token error',
    async (lng) => {
      const i18n = i18next.createInstance();
      await i18n.init({ lng, resources: { en: { translation: en }, fr: { translation: fr } } });
      for (const code of ['TOKEN_INVALID', 'TOKEN_EXPIRED', 'TOKEN_REUSED', 'UNAUTHENTICATED']) {
        expect(errorMessage(i18n.t, new DesktopError(code, 'Internal detail'))).toBe(
          i18n.t('errors.TOKEN_INVALID'),
        );
      }
    },
  );
});
