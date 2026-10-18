import { PencilSimple, SignOut, Users } from '@phosphor-icons/react';
import { has, Permission, parsePermissions } from '@silvercord/permissions';
import { Button, Glass, IconButton } from '@silvercord/ui';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  captureAccountGeneration,
  isCurrentAccountGeneration,
} from '../../api/account-generation.ts';
import { useGuild, useGuildActions, useGuildChannels } from '../../api/guilds.ts';
import { useSession } from '../../session/session-store.ts';
import dialogStyles from '../chat/dialog.module.css';
import { ChannelFormDialog } from './ChannelFormDialog.tsx';
import { ChannelIcon } from './GuildNavigation.tsx';
import styles from './guild.module.css';
import { guildErrorKey } from './guild-error-key.ts';

function LeaveGuild({ guildId, name }: { readonly guildId: string; readonly name: string }) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const epoch = useRef(0);
  const titleId = useId();
  const { leave } = useGuildActions(guildId);
  const navigate = useNavigate();
  return (
    <>
      <Button
        variant="quiet"
        onClick={() => {
          epoch.current += 1;
          leave.reset();
          dialog.current?.showModal();
        }}
      >
        <SignOut size={16} aria-hidden="true" /> {t('guilds.leaveServer')}
      </Button>
      <dialog
        ref={dialog}
        className={dialogStyles['dialog']}
        aria-labelledby={titleId}
        onClose={() => {
          epoch.current += 1;
        }}
      >
        <Glass level={3} className={dialogStyles['panel']}>
          <form
            className={dialogStyles['form']}
            onSubmit={async (event) => {
              event.preventDefault();
              const generation = captureAccountGeneration();
              const submittedIn = epoch.current;
              try {
                await leave.mutateAsync();
                if (
                  !isCurrentAccountGeneration(generation) ||
                  submittedIn !== epoch.current ||
                  !dialog.current?.open
                )
                  return;
                dialog.current?.close();
                await navigate({ to: '/app' });
              } catch {
                // The dialog stays open and announces the refusal or transport error.
              }
            }}
          >
            <h2 id={titleId} className={dialogStyles['title']}>
              {t('guilds.leaveServer')}
            </h2>
            <p className={styles['confirmName']}>{name}</p>
            {leave.error ? (
              <p className={dialogStyles['error']} role="alert">
                {t(guildErrorKey(leave.error))}
              </p>
            ) : null}
            <div className={dialogStyles['actions']}>
              <Button variant="quiet" onClick={() => dialog.current?.close()}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" loading={leave.isPending}>
                {t('guilds.leaveServer')}
              </Button>
            </div>
          </form>
        </Glass>
      </dialog>
    </>
  );
}

/** Phase 3 management surface. Conversation history remains in the existing DM routes. */
export function GuildView() {
  const { guildId, channelId } = useParams({ strict: false });
  const selfId = useSession((state) => state.user?.id);
  // Both registered routes always supply a guild id.
  return guildId ? (
    <GuildContent key={guildId} guildId={guildId} channelId={channelId} selfId={selfId} />
  ) : null;
}

function GuildContent({
  guildId,
  channelId,
  selfId,
}: {
  readonly guildId: string;
  readonly channelId: string | undefined;
  readonly selfId: string | undefined;
}) {
  const { t } = useTranslation();
  const guild = useGuild(guildId);
  const channels = useGuildChannels(guildId);
  const channel = channels.data?.items.find((item) => item.id === channelId);
  if (guild.error || channels.error)
    return (
      <p className={styles['error']} role="alert">
        {t(guildErrorKey(guild.error ?? channels.error))}
      </p>
    );
  if (!guild.data || !channels.data)
    return <div className={styles['view']} role="status" aria-label={t('guilds.loading')} />;
  if (channelId && !channel)
    return (
      <p className={styles['error']} role="alert">
        {t('guilds.channelUnavailable')}
      </p>
    );
  const data = guild.data;
  const canEdit = channel && has(parsePermissions(channel.permissions), Permission.MANAGE_CHANNELS);
  return (
    <section className={styles['view']} aria-label={channel?.name ?? data.name}>
      <Glass as="header" level={1} className={styles['header']}>
        {channel ? <ChannelIcon type={channel.type} /> : <Users size={22} aria-hidden="true" />}
        <h1>{channel?.name ?? data.name}</h1>
        {canEdit && channel ? (
          <ChannelFormDialog
            guildId={guildId}
            channel={channel}
            channels={channels.data.items}
            trigger={(open) => (
              <IconButton label={t('guilds.editChannel')} onClick={open}>
                <PencilSimple size={18} />
              </IconButton>
            )}
          />
        ) : null}
      </Glass>
      <div className={styles['details']}>
        {channel ? (
          <>
            <p className={styles['type']}>{t(`guilds.types.${channel.type}`)}</p>
            {channel.topic ? <p className={styles['topic']}>{channel.topic}</p> : null}
            {channel.type !== 'guild_category' ? (
              <p className={styles['note']}>
                {t(
                  channel.type === 'guild_voice'
                    ? 'guilds.voiceUnavailable'
                    : 'guilds.messagingUnavailable',
                )}
              </p>
            ) : null}
          </>
        ) : (
          <>
            <p className={styles['type']}>{t('guilds.memberCount', { count: data.memberCount })}</p>
            <p className={styles['note']}>{t('guilds.chooseChannel')}</p>
            {data.ownerId !== selfId ? <LeaveGuild guildId={guildId} name={data.name} /> : null}
          </>
        )}
      </div>
    </section>
  );
}
