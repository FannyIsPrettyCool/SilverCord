import {
  BADGE_EFFECTS,
  BADGE_PARTICLES,
  type BadgeDefinition,
  type BadgeVisual,
  badgeVisualSchema,
} from '@silvercord/protocol';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { BadgeMedallion } from '../profiles/BadgeShelf.tsx';
import { badgeVisual } from '../profiles/badge-visual.ts';
import styles from './settings.module.css';

export function BadgeVisualEditor({
  badge,
  value,
  onChange,
}: {
  readonly badge: BadgeDefinition;
  readonly value: BadgeVisual | null;
  readonly onChange: (value: BadgeVisual | null) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const visual = value ?? badgeVisual({ ...badge, visual: null });
  const patch = (input: Partial<BadgeVisual>) =>
    onChange(badgeVisualSchema.parse({ ...visual, ...input }));
  return (
    <fieldset className={styles['group']}>
      <legend>{t('badges.visual.title')}</legend>
      <div className={styles['badgePreview']}>
        <BadgeMedallion badge={{ ...badge, visual: value }} size={88} />
      </div>
      <label className={styles['audienceRow']} htmlFor={`${id}-effect`}>
        <span>{t('badges.visual.effect')}</span>
        <select
          id={`${id}-effect`}
          className={styles['select']}
          value={visual.effect}
          onChange={(event) =>
            patch({ effect: badgeVisualSchema.shape.effect.parse(event.target.value) })
          }
        >
          {BADGE_EFFECTS.map((item) => (
            <option key={item} value={item}>
              {t(`badges.visual.effects.${item}`)}
            </option>
          ))}
        </select>
      </label>
      <label className={styles['audienceRow']} htmlFor={`${id}-particles`}>
        <span>{t('badges.visual.particles')}</span>
        <select
          id={`${id}-particles`}
          className={styles['select']}
          value={visual.particles}
          onChange={(event) =>
            patch({ particles: badgeVisualSchema.shape.particles.parse(event.target.value) })
          }
        >
          {BADGE_PARTICLES.map((item) => (
            <option key={item} value={item}>
              {t(`badges.visual.particleTypes.${item}`)}
            </option>
          ))}
        </select>
      </label>
      <label className={styles['audienceRow']} htmlFor={`${id}-intensity`}>
        <span>{t('badges.visual.intensity')}</span>
        <input
          id={`${id}-intensity`}
          type="range"
          min="1"
          max="3"
          step="1"
          value={visual.intensity}
          onChange={(event) => patch({ intensity: Number(event.target.value) })}
        />
      </label>
      <label className={styles['audienceRow']} htmlFor={`${id}-color`}>
        <span>{t('badges.visual.color')}</span>
        <input
          id={`${id}-color`}
          type="color"
          value={visual.color ?? '#a98bff'}
          onChange={(event) => patch({ color: event.target.value })}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={value === null}
          onChange={(event) => onChange(event.target.checked ? null : visual)}
        />{' '}
        {t('badges.visual.automatic')}
      </label>
    </fieldset>
  );
}
