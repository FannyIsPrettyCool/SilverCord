import { GROUP_DM_DEFAULT_MAX_MEMBERS } from '@silvercord/protocol';
import { Button, Glass, TextField } from '@silvercord/ui';
import { useNavigate } from '@tanstack/react-router';
import { type ReactNode, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useOpenChannel } from '../../api/chat.ts';
import { useRelationships } from '../../api/social.ts';
import { Avatar, displayName } from '../presence/Avatar.tsx';
import styles from './dialog.module.css';
import { errorKey } from './error-key.ts';

/** Picks accepted friends for a new group; the server re-checks friendship and blocks. */
export function NewGroupDialog({ trigger }: { readonly trigger: (open: () => void) => ReactNode }) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const friends = useRelationships('friends');
  const openChannel = useOpenChannel();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [name, setName] = useState('');
  const limit = GROUP_DM_DEFAULT_MAX_MEMBERS - 1;

  const close = () => {
    dialog.current?.close();
    setSelected(new Set());
    setName('');
    openChannel.reset();
  };
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (next.size < limit) next.add(id);
      return next;
    });

  return (
    <>
      {trigger(() => dialog.current?.showModal())}
      <dialog
        ref={dialog}
        className={styles['dialog']}
        onClose={close}
        aria-labelledby="new-group-title"
      >
        <Glass level={3} className={styles['panel']}>
          <form
            method="dialog"
            className={styles['form']}
            onSubmit={async (event) => {
              event.preventDefault();
              const channel = await openChannel.mutateAsync({
                recipientIds: [...selected],
                ...(name.trim() ? { name: name.trim() } : {}),
              });
              close();
              await navigate({ to: '/app/channels/$channelId', params: { channelId: channel.id } });
            }}
          >
            <h2 id="new-group-title" className={styles['title']}>
              {t('chat.newGroup')}
            </h2>
            <TextField
              label={t('chat.groupName')}
              value={name}
              maxLength={100}
              onChange={(event) => setName(event.target.value)}
            />
            <p className={styles['counter']} aria-live="polite">
              {t('chat.selectedCount', { count: selected.size, limit })}
            </p>
            <ul className={styles['picker']}>
              {(friends.data ?? []).map((friend) => (
                <li key={friend.user.id}>
                  <label className={styles['pick']}>
                    <input
                      type="checkbox"
                      checked={selected.has(friend.user.id)}
                      disabled={!selected.has(friend.user.id) && selected.size >= limit}
                      onChange={() => toggle(friend.user.id)}
                    />
                    <Avatar user={friend.user} size={28} />
                    <span>{friend.metadata.nickname ?? displayName(friend.user)}</span>
                  </label>
                </li>
              ))}
            </ul>
            {openChannel.error ? (
              <p className={styles['error']} role="alert">
                {t(errorKey(openChannel.error))}
              </p>
            ) : null}
            <div className={styles['actions']}>
              <Button variant="quiet" onClick={close}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={selected.size === 0} loading={openChannel.isPending}>
                {t('chat.create')}
              </Button>
            </div>
          </form>
        </Glass>
      </dialog>
    </>
  );
}
