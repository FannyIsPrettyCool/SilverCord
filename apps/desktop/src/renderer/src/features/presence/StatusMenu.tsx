import type { PresencePreference } from '@silvercord/protocol';
import { useTranslation } from 'react-i18next';
import { useOwnPresence, useSetOwnPresence } from '../../api/presence.ts';
import styles from './status-menu.module.css';

const OPTIONS: readonly PresencePreference[] = ['online', 'idle', 'dnd', 'invisible'];

/** Own saved status; invisible reads as offline to everyone else. */
export function StatusMenu() {
  const { t } = useTranslation();
  const own = useOwnPresence();
  const setStatus = useSetOwnPresence();
  const current = own.data?.status ?? 'online';
  return (
    <fieldset className={styles['menu']} aria-label={t('presence.title')}>
      {OPTIONS.map((option) => (
        <label
          key={option}
          className={styles['option']}
          data-active={option === current || undefined}
        >
          <input
            type="radio"
            name="presence"
            value={option}
            checked={option === current}
            onChange={() => setStatus.mutate(option)}
          />
          <span className={styles['dot']} data-status={option} aria-hidden="true" />
          {t(`presence.${option}`)}
        </label>
      ))}
    </fieldset>
  );
}
