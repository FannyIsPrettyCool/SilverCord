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
import { useAmplitude } from '@silvercord/ui';
import { type CSSProperties, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMediaUrl } from '../../api/media.ts';
import { BadgeArtwork } from './BadgeArtwork.tsx';
import { attachBadgeParticles } from './badge-particles.ts';
import { badgeVisual } from './badge-visual.ts';
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
  const root = useRef<HTMLSpanElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const amplitude = useAmplitude(1);
  const visual = useMemo(() => badgeVisual(badge), [badge]);
  const moving = amplitude > 0 && visible;
  const Glyph = badge.icon.kind === 'icon' ? BADGE_ICON_COMPONENTS[badge.icon.name] : null;
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) =>
      setVisible(entry?.isIntersecting ?? false),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!moving || !canvas.current || !root.current) return;
    const color = visual.color ?? getComputedStyle(root.current).getPropertyValue('--rim-a').trim();
    const seed = [...badge.id].reduce((value, char) => value * 31 + char.charCodeAt(0), 7) % 100000;
    return attachBadgeParticles(canvas.current, visual, color || '#a98bff', seed);
  }, [moving, badge.id, visual.effect, visual.particles, visual.color, visual.intensity, visual]);
  const image = badge.icon.kind === 'image' ? badge.icon.image : null;
  return (
    <span
      ref={root}
      className={styles['medallion']}
      data-rarity={badge.rarity}
      data-effect={visual.effect}
      data-moving={moving || undefined}
      style={
        {
          width: size,
          height: size,
          ...(visual.color ? { '--rim-a': visual.color } : {}),
        } as CSSProperties
      }
      aria-hidden="true"
    >
      <span className={styles['halo']} />
      <span className={styles['face']}>
        <span className={styles['reflection']} />
        {badge.key ? (
          <BadgeArtwork kind={badge.key} />
        ) : image ? (
          <ImageIcon
            path={image.animated && !moving && image.still ? image.still : image.display}
          />
        ) : Glyph ? (
          <Glyph size={Math.round(size * 0.56)} weight="duotone" />
        ) : null}
      </span>
      <span className={styles['orbit']} />
      {visual.particles !== 'none' && amplitude > 0 ? (
        <canvas ref={canvas} className={styles['particles']} />
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
