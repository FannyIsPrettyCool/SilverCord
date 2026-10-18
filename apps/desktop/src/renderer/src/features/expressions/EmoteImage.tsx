import type { ProfileImage } from '@silvercord/protocol';
import { useAmplitude } from '@silvercord/ui';
import { useEmote, useSticker } from '../../api/expressions.ts';
import { useMediaUrl } from '../../api/media.ts';
import styles from './expressions.module.css';

/** Animated images move unless motion is reduced; then their still frame shows. */
function pathFor(image: ProfileImage, large: boolean, moving: boolean) {
  if (image.animated && !moving && image.still) return image.still;
  return large ? image.display : image.thumbnail;
}

export function ExpressionImage({
  image,
  label,
  size,
  className,
}: {
  readonly image: ProfileImage;
  readonly label: string;
  readonly size: number;
  readonly className?: string | undefined;
}) {
  const moving = useAmplitude(1) > 0;
  const url = useMediaUrl(pathFor(image, size > 48, moving));
  return url ? (
    <img
      className={className ?? styles['emote']}
      src={url}
      alt={label}
      title={label}
      draggable={false}
      style={{ width: size, height: size }}
    />
  ) : (
    <span
      role="img"
      className={styles['placeholder']}
      style={{ width: size, height: size }}
      aria-label={label}
    />
  );
}

/** A custom emote inside text; unknown or deleted ones read as `:name:`. */
export function EmoteInline({
  id,
  name,
  jumbo = false,
}: {
  readonly id: string;
  readonly name: string;
  readonly jumbo?: boolean;
}) {
  const emote = useEmote(id);
  const label = `:${emote.data?.name ?? name}:`;
  if (emote.data === null) return <>{label}</>;
  if (!emote.data)
    return <span className={styles['placeholder']} data-jumbo={jumbo || undefined} />;
  return <ExpressionImage image={emote.data.image} label={label} size={jumbo ? 48 : 22} />;
}

export function StickerInline({ id }: { readonly id: string }) {
  const sticker = useSticker(id);
  if (!sticker.data) return null;
  return (
    <ExpressionImage
      image={sticker.data.image}
      label={sticker.data.name}
      size={160}
      className={styles['sticker']}
    />
  );
}
