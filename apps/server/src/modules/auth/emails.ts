import { BRAND, type Locale } from '@silvercord/protocol';
import type { MailMessage } from '../../infra/mailer.ts';

/** Links open the desktop client through its protocol handler (BRIEF §6.10). */
export function appLink(path: string, token: string): string {
  return `${BRAND.protocolScheme}://${path}?token=${encodeURIComponent(token)}`;
}

type Template = (link: string) => { subject: string; text: string };

const TEMPLATES: Record<
  'verify' | 'reset' | 'newDevice' | 'mfaOn' | 'mfaOff',
  Record<Locale, Template>
> = {
  mfaOn: {
    en: () => ({
      subject: `Two-factor authentication turned on`,
      text: `Two-factor authentication was just turned on for your ${BRAND.name} account.\n\nIf this wasn't you, reset your password now and contact your instance admin.`,
    }),
    fr: () => ({
      subject: `Double authentification activée`,
      text: `La double authentification vient d'être activée sur votre compte ${BRAND.name}.\n\nSi ce n'était pas vous, réinitialisez votre mot de passe et contactez l'administrateur de l'instance.`,
    }),
  },
  mfaOff: {
    en: () => ({
      subject: `Two-factor authentication turned off`,
      text: `Two-factor authentication was just turned off for your ${BRAND.name} account.\n\nIf this wasn't you, reset your password now.`,
    }),
    fr: () => ({
      subject: `Double authentification désactivée`,
      text: `La double authentification vient d'être désactivée sur votre compte ${BRAND.name}.\n\nSi ce n'était pas vous, réinitialisez votre mot de passe.`,
    }),
  },
  verify: {
    en: (link) => ({
      subject: `Verify your ${BRAND.name} email`,
      text: `Open this link to verify your email address:\n\n${link}\n\nIt expires in 48 hours.`,
    }),
    fr: (link) => ({
      subject: `Vérifiez votre e-mail ${BRAND.name}`,
      text: `Ouvrez ce lien pour vérifier votre adresse e-mail :\n\n${link}\n\nIl expire dans 48 heures.`,
    }),
  },
  reset: {
    en: (link) => ({
      subject: `Reset your ${BRAND.name} password`,
      text: `Open this link to choose a new password:\n\n${link}\n\nIt expires in 30 minutes. If you didn't ask for this, ignore this email.`,
    }),
    fr: (link) => ({
      subject: `Réinitialisez votre mot de passe ${BRAND.name}`,
      text: `Ouvrez ce lien pour choisir un nouveau mot de passe :\n\n${link}\n\nIl expire dans 30 minutes. Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.`,
    }),
  },
  newDevice: {
    en: (device) => ({
      subject: `New sign-in to ${BRAND.name}`,
      text: `Your account was just signed in on a new device: ${device}.\n\nIf this wasn't you, reset your password and revoke the session in Settings.`,
    }),
    fr: (device) => ({
      subject: `Nouvelle connexion à ${BRAND.name}`,
      text: `Votre compte vient d'être connecté sur un nouvel appareil : ${device}.\n\nSi ce n'était pas vous, réinitialisez votre mot de passe et révoquez la session dans les paramètres.`,
    }),
  },
};

export function buildEmail(
  kind: keyof typeof TEMPLATES,
  locale: Locale,
  to: string,
  value: string,
): MailMessage {
  return { to, ...TEMPLATES[kind][locale](value) };
}
