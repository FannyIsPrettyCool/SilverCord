import { X } from '@phosphor-icons/react';
import { IconButton } from '@silvercord/ui';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { motion } from 'motion/react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { PrivacySettings } from './PrivacySettings.tsx';
import { ProfileSettings } from './ProfileSettings.tsx';
import { ServerProfileSettings } from './ServerProfileSettings.tsx';
import styles from './settings.module.css';

export const SETTINGS_SECTIONS = ['profile', 'privacy', 'servers'] as const;
type Section = (typeof SETTINGS_SECTIONS)[number];
const isSection = (value: string): value is Section =>
  (SETTINGS_SECTIONS as readonly string[]).includes(value);

const LABELS = {
  profile: 'settings.profile',
  privacy: 'settings.privacy',
  servers: 'settings.serverProfiles',
} as const;

/** Settings in the content area: section list on the left, the section on the right. */
export function SettingsView() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { section: raw } = useParams({ from: '/app/settings/$section' });
  const section: Section = isSection(raw) ? raw : 'profile';
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Escape inside dialogs/menus is theirs; only a bare Escape leaves settings.
      if (event.key === 'Escape' && document.activeElement?.closest('dialog') === null)
        void navigate({ to: '/app' });
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [navigate]);
  return (
    <div className={styles['settings']}>
      <nav className={styles['nav']} aria-label={t('settings.title')}>
        <h1 className={styles['navTitle']}>{t('settings.title')}</h1>
        {SETTINGS_SECTIONS.map((item) => (
          <Link
            key={item}
            to="/app/settings/$section"
            params={{ section: item }}
            className={styles['navItem']}
            aria-current={item === section ? 'page' : undefined}
          >
            {item === section ? (
              <motion.span
                layoutId="settings-pill"
                className={styles['navPill']}
                transition={{ type: 'spring', stiffness: 420, damping: 32, mass: 0.8 }}
              />
            ) : null}
            <span className={styles['navLabel']}>{t(LABELS[item])}</span>
          </Link>
        ))}
      </nav>
      <section className={styles['section']} aria-labelledby="settings-heading">
        <header className={styles['sectionHeader']}>
          <h2 id="settings-heading" className={styles['sectionTitle']}>
            {t(LABELS[section])}
          </h2>
          <IconButton label={t('settings.close')} onClick={() => void navigate({ to: '/app' })}>
            <X size={18} />
          </IconButton>
        </header>
        {section === 'profile' ? <ProfileSettings /> : null}
        {section === 'privacy' ? <PrivacySettings /> : null}
        {section === 'servers' ? <ServerProfileSettings /> : null}
      </section>
    </div>
  );
}
