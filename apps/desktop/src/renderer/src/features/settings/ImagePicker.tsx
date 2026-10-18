import type { ProfileMediaPurpose, ProfileUpload } from '@silvercord/protocol';
import { PROFILE_MEDIA_SHAPES } from '@silvercord/protocol';
import { Button } from '@silvercord/ui';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { uploadProfileImage } from '../../api/profiles.ts';
import { DesktopError } from '../../desktop.ts';
import { CropDialog } from './CropDialog.tsx';
import styles from './settings.module.css';

const ACCEPT = 'image/png,image/jpeg,image/gif,image/webp';
type Phase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'cropping'; readonly file: File }
  | { readonly kind: 'uploading'; readonly progress: number }
  | { readonly kind: 'processing' }
  | { readonly kind: 'failed'; readonly error: 'uploadFailed' | 'unsupported' | 'tooLarge' };

/**
 * Change/remove buttons for one profile image. A picked file is cropped, uploaded and
 * processed; the ready upload is handed back for the form to save (or discard).
 */
export function ImagePicker({
  purpose,
  guildId,
  label,
  canRemove,
  onReady,
  onRemove,
}: {
  readonly purpose: ProfileMediaPurpose;
  readonly guildId?: string | undefined;
  readonly label: string;
  readonly canRemove: boolean;
  readonly onReady: (upload: ProfileUpload) => void;
  readonly onRemove: () => void;
}) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const shape = PROFILE_MEDIA_SHAPES[purpose];
  useEffect(() => () => controller.current?.abort(), []);

  const start = async (file: File, crop?: Parameters<typeof uploadProfileImage>[0]['crop']) => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setPhase({ kind: 'uploading', progress: 0 });
    try {
      const upload = await uploadProfileImage({
        file,
        purpose,
        ...(crop ? { crop } : {}),
        ...(guildId ? { guildId } : {}),
        signal: current.signal,
        onProgress: (progress) =>
          setPhase(progress >= 1 ? { kind: 'processing' } : { kind: 'uploading', progress }),
      });
      if (current.signal.aborted) return;
      if (upload.state !== 'ready' || !upload.image) {
        setPhase({
          kind: 'failed',
          error: upload.failure === 'UNSUPPORTED_TYPE' ? 'unsupported' : 'uploadFailed',
        });
        return;
      }
      setPhase({ kind: 'idle' });
      onReady(upload);
    } catch (error) {
      if (current.signal.aborted) return;
      setPhase({
        kind: 'failed',
        error:
          error instanceof DesktopError && error.code === 'PAYLOAD_TOO_LARGE'
            ? 'tooLarge'
            : 'uploadFailed',
      });
    }
  };

  const busy = phase.kind === 'uploading' || phase.kind === 'processing';
  return (
    <div className={styles['imagePicker']}>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        hidden
        aria-label={label}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) return;
          if (!ACCEPT.split(',').includes(file.type))
            return setPhase({ kind: 'failed', error: 'unsupported' });
          if (file.size > shape.maxBytes) return setPhase({ kind: 'failed', error: 'tooLarge' });
          if (shape.aspect === null) void start(file);
          else setPhase({ kind: 'cropping', file });
        }}
      />
      <Button variant="quiet" loading={busy} onClick={() => input.current?.click()}>
        {t('settings.change')}
      </Button>
      {canRemove && !busy ? (
        <Button variant="quiet" onClick={onRemove}>
          {t('settings.remove')}
        </Button>
      ) : null}
      <span className={styles['pickerStatus']} role="status" aria-live="polite">
        {phase.kind === 'uploading'
          ? t('settings.uploading', { percent: Math.round(phase.progress * 100) })
          : phase.kind === 'processing'
            ? t('settings.processing')
            : null}
      </span>
      {phase.kind === 'failed' ? (
        <span className={styles['pickerError']} role="alert">
          {t(`profileErrors.${phase.error}`)}
        </span>
      ) : null}
      {phase.kind === 'cropping' && shape.aspect !== null ? (
        <CropDialog
          file={phase.file}
          aspect={shape.aspect}
          round={shape.aspect === 1}
          onCancel={() => setPhase({ kind: 'idle' })}
          onApply={(crop) => void start(phase.file, crop)}
        />
      ) : null}
    </div>
  );
}
