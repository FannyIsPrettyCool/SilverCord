import {
  Cake,
  Code,
  Crown,
  Diamond,
  Fire,
  Flag,
  Flower,
  GameController,
  Ghost,
  Heart,
  type Icon,
  Lightning,
  LockKey,
  Medal,
  Moon,
  MusicNotes,
  PaintBrush,
  Planet,
  Rocket,
  SealCheck,
  ShieldCheck,
  Sparkle,
  Star,
  Sun,
  Trophy,
} from '@phosphor-icons/react';
import type { BadgeAward, BadgeDefinition, BadgeIconName } from '@silvercord/protocol';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { useMediaUrl } from '../../api/media.ts';
import styles from './badges.module.css';

export const BADGE_ICON_COMPONENTS: Readonly<Record<BadgeIconName, Icon>> = {
  sparkle: Sparkle,
  crown: Crown,
  star: Star,
  heart: Heart,
  lightning: Lightning,
  'shield-check': ShieldCheck,
  'seal-check': SealCheck,
  cake: Cake,
  flag: Flag,
  trophy: Trophy,
  medal: Medal,
  rocket: Rocket,
  flower: Flower,
  moon: Moon,
  sun: Sun,
  fire: Fire,
  code: Code,
  'paint-brush': PaintBrush,
  'music-notes': MusicNotes,
  'game-controller': GameController,
  'lock-key': LockKey,
  diamond: Diamond,
  ghost: Ghost,
  planet: Planet,
};

/** Built-ins are localized by key; manual badges carry their own text. */
export function useBadgeText() {
  const { t } = useTranslation();
  return (badge: BadgeDefinition, level = 1) =>
    badge.key
      ? {
          name: t(`badges.builtin.${badge.key}.name`),
          description: t(`badges.builtin.${badge.key}.description`, { count: level }),
        }
      : { name: badge.name, description: badge.description };
}

function ImageIcon({ path }: { readonly path: string }) {
  const url = useMediaUrl(path);
  return url ? <img className={styles['image']} src={url} alt="" draggable={false} /> : null;
}

export function BadgeMedallion({
  badge,
  size = 28,
}: {
  readonly badge: BadgeDefinition;
  readonly size?: number;
}) {
  const Glyph = badge.icon.kind === 'icon' ? BADGE_ICON_COMPONENTS[badge.icon.name] : null;
  return (
    <span
      className={styles['medallion']}
      data-rarity={badge.rarity}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {badge.icon.kind === 'image' ? (
        <ImageIcon path={badge.icon.image.thumbnail} />
      ) : Glyph ? (
        <Glyph size={Math.round(size * 0.58)} weight="duotone" />
      ) : null}
    </span>
  );
}

function ShelfItem({ award }: { readonly award: BadgeAward }) {
  const { t, i18n } = useTranslation();
  const text = useBadgeText()(award.badge, award.level);
  const tipId = useId();
  return (
    <li className={styles['item']}>
      <button type="button" className={styles['badge']} aria-describedby={tipId}>
        <BadgeMedallion badge={award.badge} />
        <span className={styles['srOnly']}>{text.name}</span>
      </button>
      <span role="tooltip" id={tipId} className={styles['tip']}>
        <strong>{text.name}</strong>
        {text.description ? <span>{text.description}</span> : null}
        <span className={styles['tipMeta']}>
          {t(`badges.rarity.${award.badge.rarity}`)} ·{' '}
          {new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(
            new Date(award.awardedAt),
          )}
        </span>
      </span>
    </li>
  );
}

const SHELF_MAX = 8;

/** Pinned first (server order), then the rest; overflow collapses into a count. */
export function BadgeShelf({ awards }: { readonly awards: readonly BadgeAward[] }) {
  const { t } = useTranslation();
  if (awards.length === 0) return null;
  const shown = awards.slice(0, SHELF_MAX);
  const more = awards.length - shown.length;
  return (
    <ul className={styles['shelf']} aria-label={t('settings.section.badges')}>
      {shown.map((award) => (
        <ShelfItem key={award.badge.id} award={award} />
      ))}
      {more > 0 ? <li className={styles['more']}>+{more}</li> : null}
    </ul>
  );
}
