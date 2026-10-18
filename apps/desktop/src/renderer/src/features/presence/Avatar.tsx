import type { PresenceStatus, ProfileImage, PublicUser } from '@silvercord/protocol';
import { useAmplitude } from '@silvercord/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMediaUrl } from '../../api/media.ts';
import { useSummary } from '../../api/profiles.ts';
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

/**
 * Which variant to show: animated images rest on their still frame unless `animate` (or
 * hover) asks for motion and motion is allowed; small sizes use the thumbnail.
 */
export function avatarPath(image: ProfileImage, size: number, moving: boolean): string {
  if (image.animated && !moving && image.still) return image.still;
  return size > 128 ? image.display : image.thumbnail;
}

export function ImageAvatar({
  image,
  size,
  animate,
}: {
  readonly image: ProfileImage;
  readonly size: number;
  readonly animate: boolean;
}) {
  const url = useMediaUrl(avatarPath(image, size, animate));
  return url ? <img className={styles['image']} src={url} alt="" draggable={false} /> : null;
}

export function Avatar({
  user,
  size = 36,
  status,
  guildId,
  animate = false,
  image: override,
}: {
  readonly user: PublicUser;
  readonly size?: number;
  readonly status?: PresenceStatus | undefined;
  /** Shows the per-server avatar when the user has one there. */
  readonly guildId?: string | undefined;
  /** Play animated avatars without hover (popouts, profiles). */
  readonly animate?: boolean;
  /** A specific image (editor previews) instead of the user's current one. */
  readonly image?: ProfileImage | null;
}) {
  const { t } = useTranslation();
  const summary = useSummary(user.id, guildId);
  const [hovered, setHovered] = useState(false);
  const motionAllowed = useAmplitude(1) > 0;
  const image = override === undefined ? (summary.data?.avatar ?? null) : override;
  const name = displayName(user);
  return (
    <span
      className={styles['avatar']}
      style={{ width: size, height: size, '--avatar-hue': hueOf(user.id) } as React.CSSProperties}
      aria-hidden="true"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      {image ? (
        <ImageAvatar image={image} size={size} animate={motionAllowed && (animate || hovered)} />
      ) : (
        <span className={styles['initial']} style={{ fontSize: size * 0.42 }}>
          {[...name][0]?.toUpperCase()}
        </span>
      )}
      {status ? (
        <span className={styles['presence']} data-status={status} title={t(`presence.${status}`)} />
      ) : null}
    </span>
  );
}
