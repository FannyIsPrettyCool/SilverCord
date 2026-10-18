import type { CustomStatus, PresenceStatus, ProfileImage, PublicUser } from '@silvercord/protocol';
import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useMediaUrl } from '../../api/media.ts';
import { MarkdownView } from '../chat/MarkdownView.tsx';
import { Avatar, avatarPath } from '../presence/Avatar.tsx';
import styles from './profile.module.css';

export const hex = (color: number) => `#${color.toString(16).padStart(6, '0')}`;

/** Everything a card can show; absent sections were not shared (or not set). */
export interface CardData {
  readonly user: PublicUser;
  readonly avatar: ProfileImage | null;
  readonly banner?: ProfileImage | null | undefined;
  readonly accentColor: number | null;
  readonly bannerColor: number | null;
  readonly themeColors: readonly [number, number] | null;
  readonly pronouns?: string | null | undefined;
  readonly bio?: string | null | undefined;
  readonly customStatus?: CustomStatus | null | undefined;
  readonly memberSince?: string | undefined;
  readonly nickname?: string | null | undefined;
}

/** Banner image, else banner colour, else the avatar's dominant colour, else the accent. */
function bannerFill(card: CardData): string {
  const color = card.bannerColor ?? card.avatar?.dominantColor ?? card.accentColor;
  return color === null ? 'var(--color-accent)' : hex(color);
}

export function cardStyle(card: CardData): CSSProperties {
  const [primary, secondary] = card.themeColors ?? [];
  return {
    '--card-accent': card.accentColor === null ? 'var(--color-accent)' : hex(card.accentColor),
    '--card-banner': bannerFill(card),
    ...(primary !== undefined && secondary !== undefined
      ? { '--card-theme-a': hex(primary), '--card-theme-b': hex(secondary) }
      : {}),
  } as CSSProperties;
}

function Banner({ image, animate }: { readonly image: ProfileImage; readonly animate: boolean }) {
  const url = useMediaUrl(avatarPath(image, 1500, animate));
  return url ? <img className={styles['bannerImage']} src={url} alt="" draggable={false} /> : null;
}

export function StatusLine({ status }: { readonly status: CustomStatus }) {
  return (
    <p className={styles['customStatus']}>
      {status.emoji && !status.emoji.startsWith('custom:') ? (
        <span className={styles['statusEmoji']} aria-hidden={status.text ? true : undefined}>
          {status.emoji}
        </span>
      ) : null}
      {status.text ? <span>{status.text}</span> : null}
    </p>
  );
}

/**
 * The glass profile card (popout, full view header, editor preview). Colour comes from the
 * banner and profile theme; text stays on theme surfaces so contrast never depends on them.
 */
export function ProfileCard({
  card,
  size = 'popout',
  animate = true,
  presence,
  children,
}: {
  readonly card: CardData;
  readonly size?: 'popout' | 'full';
  readonly animate?: boolean;
  readonly presence?: PresenceStatus | undefined;
  readonly children?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const name = card.nickname ?? card.user.displayName ?? card.user.username;
  return (
    <article
      className={styles['card']}
      data-size={size}
      data-themed={card.themeColors ? true : undefined}
      style={cardStyle(card)}
      aria-label={name}
    >
      <div className={styles['banner']}>
        {card.banner ? <Banner image={card.banner} animate={animate} /> : null}
      </div>
      <div className={styles['identityRow']}>
        <span className={styles['avatarRing']}>
          <Avatar
            user={card.user}
            size={size === 'full' ? 112 : 84}
            image={card.avatar}
            animate={animate}
            status={presence}
          />
        </span>
      </div>
      <div className={styles['body']}>
        <header className={styles['names']}>
          <h2 className={styles['name']}>{name}</h2>
          <p className={styles['handle']}>
            <span>{card.user.username}</span>
            {card.pronouns ? (
              <>
                <span aria-hidden="true"> · </span>
                <span>{card.pronouns}</span>
              </>
            ) : null}
          </p>
          {card.customStatus ? <StatusLine status={card.customStatus} /> : null}
        </header>
        {card.bio ? (
          <section className={styles['bio']}>
            <MarkdownView content={card.bio} context={{ users: new Map(), selfId: null }} />
          </section>
        ) : null}
        {card.memberSince ? (
          <dl className={styles['facts']}>
            <dt>{t('profile.memberSince')}</dt>
            <dd>
              {new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(
                new Date(card.memberSince),
              )}
            </dd>
          </dl>
        ) : null}
        {children}
      </div>
    </article>
  );
}
