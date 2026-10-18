import type { PresenceStatus, PublicUser } from '@silvercord/protocol';
import { useTranslation } from 'react-i18next';
import styles from './avatar.module.css';

/** Stable hue per user so initials avatars stay recognizable without uploaded images. */
function hueOf(id: string): number {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % 360;
}

export function displayName(user: Pick<PublicUser, 'username' | 'displayName'>): string {
  return user.displayName ?? user.username;
}

export function Avatar({
  user,
  size = 36,
  status,
}: {
  readonly user: PublicUser;
  readonly size?: number;
  readonly status?: PresenceStatus | undefined;
}) {
  const { t } = useTranslation();
  const name = displayName(user);
  return (
    <span
      className={styles['avatar']}
      style={{ width: size, height: size, '--avatar-hue': hueOf(user.id) } as React.CSSProperties}
      aria-hidden="true"
    >
      <span className={styles['initial']} style={{ fontSize: size * 0.42 }}>
        {[...name][0]?.toUpperCase()}
      </span>
      {status ? (
        <span className={styles['presence']} data-status={status} title={t(`presence.${status}`)} />
      ) : null}
    </span>
  );
}
