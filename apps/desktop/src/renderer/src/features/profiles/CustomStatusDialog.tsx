import { CUSTOM_STATUS_MAX, statusEmojiSchema } from '@silvercord/protocol';
import { Button, Glass, TextField } from '@silvercord/ui';
import { type ReactNode, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useOwnProfile, useSetCustomStatus } from '../../api/profiles.ts';
import styles from '../chat/dialog.module.css';
import { EmojiPicker } from '../expressions/EmojiPicker.tsx';
import { AnchoredPanel } from '../shell/AnchoredPanel.tsx';

export const CLEAR_AFTER = ['30m', '1h', '4h', 'today', 'never'] as const;
type ClearAfter = (typeof CLEAR_AFTER)[number];

/** When a status set now with `choice` should expire (local end of day for "today"). */
export function expiryFor(choice: ClearAfter, now = new Date()): string | null {
  const minutes = { '30m': 30, '1h': 60, '4h': 240 } as const;
  if (choice === 'never') return null;
  if (choice === 'today') {
    const end = new Date(now);
    end.setHours(23, 59, 59, 0);
    return end.toISOString();
  }
  return new Date(now.getTime() + minutes[choice] * 60_000).toISOString();
}

/** Emoji, text and clear-after for the own custom status (docs/spec/profiles.md). */
export function CustomStatusDialog({
  trigger,
}: {
  readonly trigger: (open: () => void) => ReactNode;
}) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const clearId = useId();
  const own = useOwnProfile();
  const save = useSetCustomStatus();
  const [text, setText] = useState('');
  const [emoji, setEmoji] = useState('');
  const [clearAfter, setClearAfter] = useState<ClearAfter>('today');
  const current = own.data?.customStatus ?? null;
  const emojiValid = emoji === '' || statusEmojiSchema.safeParse(emoji).success;

  const open = () => {
    setText(current?.text ?? '');
    setEmoji(current?.emoji && !current.emoji.startsWith('custom:') ? current.emoji : '');
    setClearAfter(current && !current.expiresAt ? 'never' : 'today');
    save.reset();
    dialog.current?.showModal();
  };
  const close = () => dialog.current?.close();

  return (
    <>
      {trigger(open)}
      <dialog ref={dialog} className={styles['dialog']} aria-labelledby={titleId}>
        <Glass level={3} className={styles['panel']}>
          <form
            className={styles['form']}
            onSubmit={async (event) => {
              event.preventDefault();
              await save.mutateAsync({
                text: text.trim() || null,
                emoji: emoji || null,
                expiresAt: expiryFor(clearAfter),
              });
              close();
            }}
          >
            <h2 id={titleId} className={styles['title']}>
              {current ? t('customStatus.edit') : t('customStatus.set')}
            </h2>
            <TextField
              label={t('customStatus.emoji')}
              value={emoji}
              maxLength={16}
              inputMode="text"
              error={emojiValid ? undefined : t('customStatus.emoji')}
              onChange={(event) => setEmoji(event.target.value.trim())}
            />
            <AnchoredPanel
              label={t('customStatus.emoji')}
              trigger={(props) => (
                <Button variant="quiet" {...props}>
                  {emoji || t('customStatus.emoji')}
                </Button>
              )}
            >
              {(close) => (
                <EmojiPicker
                  emotes={false}
                  onPick={(picked) => {
                    if (picked.kind === 'unicode') setEmoji(picked.emoji);
                    close();
                  }}
                />
              )}
            </AnchoredPanel>
            <TextField
              label={t('customStatus.text')}
              value={text}
              maxLength={CUSTOM_STATUS_MAX}
              onChange={(event) => setText(event.target.value)}
            />
            <label className={styles['field']} htmlFor={clearId}>
              <span>{t('customStatus.clearAfter')}</span>
              <select
                id={clearId}
                className={styles['select']}
                value={clearAfter}
                onChange={(event) => setClearAfter(event.target.value as ClearAfter)}
              >
                {CLEAR_AFTER.map((choice) => (
                  <option key={choice} value={choice}>
                    {t(`customStatus.after.${choice}`)}
                  </option>
                ))}
              </select>
            </label>
            <div className={styles['actions']}>
              {current ? (
                <Button
                  variant="quiet"
                  onClick={async () => {
                    await save.mutateAsync(null);
                    close();
                  }}
                >
                  {t('customStatus.clear')}
                </Button>
              ) : null}
              <Button variant="quiet" onClick={close}>
                {t('common.cancel')}
              </Button>
              <Button
                type="submit"
                loading={save.isPending}
                disabled={!emojiValid || (text.trim() === '' && emoji === '')}
              >
                {t('customStatus.save')}
              </Button>
            </div>
          </form>
        </Glass>
      </dialog>
    </>
  );
}
