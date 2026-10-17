import i18next from 'i18next';
import ICU from 'i18next-icu';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import fr from './locales/fr.json';

export const SUPPORTED_LOCALES = ['en', 'fr'] as const;
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

export const resources = { en: { translation: en }, fr: { translation: fr } } as const;

declare module 'i18next' {
  interface CustomTypeOptions {
    resources: (typeof resources)['en'];
  }
}

/** First supported language of the OS preference list, English otherwise. */
export function detectLocale(languages: readonly string[] = navigator.languages): AppLocale {
  for (const language of languages) {
    const base = language.toLowerCase().split('-')[0];
    const match = SUPPORTED_LOCALES.find((locale) => locale === base);
    if (match) return match;
  }
  return 'en';
}

/** ICU message format so plurals and numbers follow each locale (BRIEF §6.11). */
export async function initI18n(locale: AppLocale = detectLocale()) {
  await i18next
    .use(ICU)
    .use(initReactI18next)
    .init({
      resources,
      lng: locale,
      fallbackLng: 'en',
      returnNull: false,
      interpolation: { escapeValue: false },
    });
  document.documentElement.lang = locale;
  return i18next;
}
