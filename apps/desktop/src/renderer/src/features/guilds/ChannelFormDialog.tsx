import type { GuildChannel, GuildChannelCreate } from '@silvercord/protocol';
import { Button, Glass, TextField } from '@silvercord/ui';
import { useNavigate } from '@tanstack/react-router';
import { type ReactNode, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  captureAccountGeneration,
  isCurrentAccountGeneration,
} from '../../api/account-generation.ts';
import { useGuildChannelActions } from '../../api/guilds.ts';
import dialogStyles from '../chat/dialog.module.css';
import styles from './guild.module.css';
import { guildErrorKey } from './guild-error-key.ts';

const CHANNEL_TYPES = ['guild_text', 'guild_voice', 'guild_category', 'announcement'] as const;

export function ChannelFormDialog({
  guildId,
  channels,
  channel,
  trigger,
}: {
  readonly guildId: string;
  readonly channels: readonly GuildChannel[];
  readonly channel?: GuildChannel;
  readonly trigger: (open: () => void) => ReactNode;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const typeId = useId();
  const parentId = useId();
  const topicId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const epoch = useRef(0);
  const [name, setName] = useState(channel?.name ?? '');
  const [topic, setTopic] = useState(channel?.topic ?? '');
  const [type, setType] = useState<GuildChannelCreate['type']>('guild_text');
  const [parent, setParent] = useState('');
  const { create, edit } = useGuildChannelActions(guildId);
  const mutation = channel ? edit : create;
  const navigate = useNavigate();
  const reset = () => {
    epoch.current += 1;
    setName(channel?.name ?? '');
    setTopic(channel?.topic ?? '');
    setType('guild_text');
    setParent('');
    create.reset();
    edit.reset();
  };

  return (
    <>
      {trigger(() => {
        reset();
        dialog.current?.showModal();
      })}
      <dialog
        ref={dialog}
        className={dialogStyles['dialog']}
        aria-labelledby={titleId}
        onClose={reset}
      >
        <Glass level={3} className={dialogStyles['panel']}>
          <form
            className={dialogStyles['form']}
            onSubmit={async (event) => {
              event.preventDefault();
              const generation = captureAccountGeneration();
              const submittedIn = epoch.current;
              try {
                const result = channel
                  ? await edit.mutateAsync({
                      channelId: channel.id,
                      name: name.trim(),
                      topic: topic.trim() || null,
                      expectedVersion: channel.version,
                    })
                  : await create.mutateAsync({
                      type,
                      name: name.trim(),
                      parentId: type === 'guild_category' ? null : parent || null,
                      topic: topic.trim() || null,
                    });
                if (
                  !isCurrentAccountGeneration(generation) ||
                  submittedIn !== epoch.current ||
                  !dialog.current?.open
                )
                  return;
                dialog.current?.close();
                await navigate({
                  to: '/app/guilds/$guildId/channels/$channelId',
                  params: { guildId, channelId: result.id },
                });
              } catch {
                // Keep the form and its values available for correction or retry.
              }
            }}
          >
            <h2 id={titleId} className={dialogStyles['title']}>
              {t(channel ? 'guilds.editChannel' : 'guilds.createChannel')}
            </h2>
            <TextField
              label={t('guilds.channelName')}
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={100}
              required
              disabled={mutation.isPending}
            />
            {!channel ? (
              <>
                <label className={styles['field']} htmlFor={typeId}>
                  {t('guilds.channelType')}
                  <select
                    id={typeId}
                    value={type}
                    onChange={(event) => {
                      const value = CHANNEL_TYPES.find(
                        (candidate) => candidate === event.target.value,
                      );
                      if (value) setType(value);
                    }}
                    disabled={mutation.isPending}
                  >
                    {CHANNEL_TYPES.map((value) => (
                      <option key={value} value={value}>
                        {t(`guilds.types.${value}`)}
                      </option>
                    ))}
                  </select>
                </label>
                {type !== 'guild_category' ? (
                  <label className={styles['field']} htmlFor={parentId}>
                    {t('guilds.category')}
                    <select
                      id={parentId}
                      value={parent}
                      onChange={(event) => setParent(event.target.value)}
                      disabled={mutation.isPending}
                    >
                      <option value="">{t('guilds.noCategory')}</option>
                      {channels
                        .filter((item) => item.type === 'guild_category')
                        .map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                    </select>
                  </label>
                ) : null}
              </>
            ) : null}
            <label className={styles['field']} htmlFor={topicId}>
              {t('guilds.topic')}
              <textarea
                id={topicId}
                value={topic}
                onChange={(event) => setTopic(event.target.value)}
                maxLength={1024}
                rows={3}
                disabled={mutation.isPending}
              />
            </label>
            {mutation.error ? (
              <p className={dialogStyles['error']} role="alert">
                {t(guildErrorKey(mutation.error))}
              </p>
            ) : null}
            <div className={dialogStyles['actions']}>
              <Button variant="quiet" onClick={() => dialog.current?.close()}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={!name.trim()} loading={mutation.isPending}>
                {t(channel ? 'guilds.save' : 'chat.create')}
              </Button>
            </div>
          </form>
        </Glass>
      </dialog>
    </>
  );
}
