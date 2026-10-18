import type { ProfileImage } from '@silvercord/protocol';
import { Button, Glass, TextField } from '@silvercord/ui';
import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useExpressionAdmin, useGuildExpressions } from '../../api/expressions.ts';
import styles from '../chat/dialog.module.css';
import { ImagePicker } from '../settings/ImagePicker.tsx';
import { ExpressionImage } from './EmoteImage.tsx';

function Manager({ guildId }: { readonly guildId: string }) {
  const { t } = useTranslation();
  const content = useGuildExpressions(guildId);
  const actions = useExpressionAdmin(guildId);
  const [kind, setKind] = useState<'emote' | 'sticker'>('emote');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [upload, setUpload] = useState<{ id: string; image: ProfileImage | null } | null>(null);
  const create = kind === 'emote' ? actions.createEmote : actions.createSticker;
  const valid = kind === 'emote' ? /^[a-zA-Z0-9_]{2,32}$/.test(name) : name.trim().length > 0;
  const error =
    content.error ||
    actions.createEmote.error ||
    actions.createSticker.error ||
    actions.deleteEmote.error ||
    actions.deleteSticker.error;
  return (
    <div className={styles['form']}>
      <div role="tablist" aria-label={t('expressions.manage')}>
        {(['emote', 'sticker'] as const).map((value) => (
          <Button
            key={value}
            role="tab"
            aria-selected={kind === value}
            variant="quiet"
            onClick={() => {
              setKind(value);
              setName('');
              setUpload(null);
            }}
          >
            {t(value === 'emote' ? 'expressions.emotes' : 'expressions.stickers')}
          </Button>
        ))}
      </div>
      <form
        className={styles['form']}
        onSubmit={async (event) => {
          event.preventDefault();
          if (!upload || !valid) return;
          try {
            if (kind === 'emote')
              await actions.createEmote.mutateAsync({ name, uploadId: upload.id });
            else
              await actions.createSticker.mutateAsync({
                name: name.trim(),
                description,
                relatedEmoji: null,
                uploadId: upload.id,
              });
            setName('');
            setDescription('');
            setUpload(null);
          } catch {
            /* The form announces the mutation error. */
          }
        }}
      >
        <TextField
          label={t('expressions.emoteName')}
          value={name}
          maxLength={32}
          required
          onChange={(event) => setName(event.target.value)}
        />
        <p>{t(kind === 'emote' ? 'expressions.emoteHint' : 'expressions.stickerHint')}</p>
        {kind === 'sticker' ? (
          <TextField
            label={t('expressions.description')}
            value={description}
            maxLength={100}
            onChange={(event) => setDescription(event.target.value)}
          />
        ) : null}
        {upload?.image ? <ExpressionImage image={upload.image} label={name} size={64} /> : null}
        <ImagePicker
          key={kind}
          purpose={kind}
          guildId={guildId}
          label={t('expressions.add')}
          canRemove={!!upload}
          onReady={(value) => setUpload({ id: value.id, image: value.image })}
          onRemove={() => setUpload(null)}
        />
        <Button type="submit" disabled={!valid || !upload} loading={create.isPending}>
          {t('expressions.add')}
        </Button>
      </form>
      {error ? <p role="alert">{t('expressions.failed')}</p> : null}
      <ul>
        {(kind === 'emote' ? (content.data?.emotes ?? []) : (content.data?.stickers ?? [])).map(
          (item) => (
            <li key={item.id}>
              <ExpressionImage image={item.image} label={item.name} size={36} /> {item.name}{' '}
              <Button
                variant="quiet"
                loading={actions.deleteEmote.isPending || actions.deleteSticker.isPending}
                onClick={() =>
                  kind === 'emote'
                    ? actions.deleteEmote.mutate(item.id)
                    : actions.deleteSticker.mutate(item.id)
                }
              >
                {t('expressions.delete')}
              </Button>
            </li>
          ),
        )}
      </ul>
    </div>
  );
}
export function ExpressionManager({ guildId }: { readonly guildId: string }) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  return (
    <>
      <Button variant="quiet" onClick={() => dialog.current?.showModal()}>
        {t('expressions.manage')}
      </Button>
      <dialog ref={dialog} className={styles['dialog']} aria-labelledby={id}>
        <Glass level={3} className={styles['panel']}>
          <h2 id={id}>{t('expressions.manage')}</h2>
          <Manager guildId={guildId} />
          <Button variant="quiet" onClick={() => dialog.current?.close()}>
            {t('common.close')}
          </Button>
        </Glass>
      </dialog>
    </>
  );
}
