import { DownloadSimple, FileText } from '@phosphor-icons/react';
import type { Attachment, MediaVariant } from '@silvercord/protocol';
import { IconButton } from '@silvercord/ui';
import { decode } from 'blurhash';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useMediaUrl } from '../../api/media.ts';
import { desktop, unwrap } from '../../desktop.ts';
import styles from './attachments.module.css';

const MAX_WIDTH = 420;
const MAX_HEIGHT = 320;

function variant(attachment: Attachment, name: MediaVariant) {
  return attachment.variants.find((candidate) => candidate.variant === name);
}

function blurhashUrl(hash: string | null): string | undefined {
  if (!hash) return undefined;
  try {
    const pixels = decode(hash, 16, 16);
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    const context = canvas.getContext('2d');
    if (!context) return undefined;
    context.putImageData(new ImageData(new Uint8ClampedArray(pixels), 16, 16), 0, 0);
    return canvas.toDataURL();
  } catch {
    return undefined;
  }
}

export function formatBytes(bytes: number, locale: string): string {
  const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte'] as const;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: units[unit],
    unitDisplay: 'short',
    maximumFractionDigits: value < 10 && unit > 0 ? 1 : 0,
  }).format(value);
}

function save(attachment: Attachment) {
  const download = variant(attachment, 'download');
  if (download)
    void unwrap(desktop().media.download({ path: download.path, filename: attachment.filename }));
}

function Visual({ attachment }: { readonly attachment: Attachment }) {
  const { t } = useTranslation();
  const width = attachment.width ?? MAX_WIDTH;
  const height = attachment.height ?? MAX_HEIGHT;
  const scale = Math.min(1, MAX_WIDTH / width, MAX_HEIGHT / height);
  const box = { width: Math.round(width * scale), height: Math.round(height * scale) };
  // Small renders use the thumbnail; animated images need the display variant to move.
  const source =
    attachment.kind === 'video'
      ? variant(attachment, 'download')
      : box.width <= 480 && !attachment.animated
        ? (variant(attachment, 'thumbnail') ?? variant(attachment, 'display'))
        : variant(attachment, 'display');
  const url = useMediaUrl(source?.path);
  const placeholder = useMemo(() => blurhashUrl(attachment.blurhash), [attachment.blurhash]);
  return (
    <figure
      className={styles['visual']}
      style={{
        ...box,
        backgroundImage: placeholder ? `url(${placeholder})` : undefined,
      }}
    >
      {url && attachment.kind === 'video' ? (
        // biome-ignore lint/a11y/useMediaCaption: user uploads carry no caption track.
        <video
          className={styles['media']}
          src={url}
          controls
          preload="metadata"
          aria-label={attachment.filename}
        />
      ) : url ? (
        <img className={styles['media']} src={url} alt={attachment.filename} draggable={false} />
      ) : null}
      <IconButton
        label={t('chat.download')}
        className={styles['save']}
        onClick={() => save(attachment)}
      >
        <DownloadSimple size={16} weight="bold" />
      </IconButton>
    </figure>
  );
}

function FileCard({ attachment }: { readonly attachment: Attachment }) {
  const { t, i18n } = useTranslation();
  return (
    <div className={styles['file']}>
      <FileText size={28} weight="duotone" aria-hidden="true" />
      <span className={styles['fileMeta']}>
        <span className={styles['fileName']}>{attachment.filename}</span>
        <span className={styles['fileSize']}>
          {formatBytes(attachment.sizeBytes, i18n.language)}
        </span>
      </span>
      <IconButton label={t('chat.download')} onClick={() => save(attachment)}>
        <DownloadSimple size={18} weight="bold" />
      </IconButton>
    </div>
  );
}

export function Attachments({ items }: { readonly items: readonly Attachment[] }) {
  if (items.length === 0) return null;
  return (
    <div className={styles['attachments']}>
      {items.map((attachment) =>
        attachment.kind === 'file' ? (
          <FileCard key={attachment.id} attachment={attachment} />
        ) : (
          <Visual key={attachment.id} attachment={attachment} />
        ),
      )}
    </div>
  );
}
