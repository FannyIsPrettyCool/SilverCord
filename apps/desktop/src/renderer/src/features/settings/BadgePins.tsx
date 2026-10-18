import { BADGE_PINS_MAX } from '@silvercord/protocol';
import { useTranslation } from 'react-i18next';
import { useOwnBadges, useSetBadgePins } from '../../api/badges.ts';
import { BadgeMedallion, useBadgeText } from '../profiles/BadgeShelf.tsx';
import styles from './settings.module.css';

/** Held badges as toggles; pinned ones lead the shelf in the order they were pinned. */
export function BadgePins() {
  const { t } = useTranslation();
  const own = useOwnBadges();
  const save = useSetBadgePins();
  const text = useBadgeText();
  const awards = own.data ?? [];
  if (awards.length === 0) return <p className={styles['empty']}>{t('badges.none')}</p>;
  const pinned = awards
    .filter((award) => award.pin !== null)
    .sort((a, b) => (a.pin ?? 0) - (b.pin ?? 0))
    .map((award) => award.badge.id);
  const toggle = (badgeId: string) => {
    const next = pinned.includes(badgeId)
      ? pinned.filter((id) => id !== badgeId)
      : [...pinned, badgeId].slice(0, BADGE_PINS_MAX);
    save.mutate(next);
  };
  return (
    <div className={styles['pins']}>
      <span className={styles['counter']} aria-live="polite">
        {t('badges.pinned', { count: pinned.length, max: BADGE_PINS_MAX })}
      </span>
      <ul className={styles['pinList']}>
        {awards.map((award) => {
          const index = pinned.indexOf(award.badge.id);
          const label = text(award.badge, award.level).name;
          return (
            <li key={award.badge.id}>
              <button
                type="button"
                className={styles['pin']}
                aria-pressed={index >= 0}
                disabled={save.isPending || (index < 0 && pinned.length >= BADGE_PINS_MAX)}
                onClick={() => toggle(award.badge.id)}
              >
                <BadgeMedallion badge={award.badge} size={32} />
                <span>{label}</span>
                {index >= 0 ? <span className={styles['pinIndex']}>{index + 1}</span> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
