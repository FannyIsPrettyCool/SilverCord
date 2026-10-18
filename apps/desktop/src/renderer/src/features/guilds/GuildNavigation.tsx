import { Hash, Megaphone, PencilSimple, Plus, SpeakerHigh, Stack } from '@phosphor-icons/react';
import { has, Permission, parsePermissions } from '@silvercord/permissions';
import { IconButton } from '@silvercord/ui';
import { Link, useParams } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useGuild, useGuildChannels, useGuilds } from '../../api/guilds.ts';
import { ChannelFormDialog } from './ChannelFormDialog.tsx';
import { GuildFormDialog } from './GuildFormDialog.tsx';
import styles from './guild.module.css';
import { guildErrorKey } from './guild-error-key.ts';
import { guildInitials, orderedGuildChannels } from './guild-state.ts';

export function ChannelIcon({ type }: { readonly type: string }) {
  if (type === 'guild_category') return <Stack size={17} aria-hidden="true" />;
  if (type === 'guild_voice') return <SpeakerHigh size={17} aria-hidden="true" />;
  if (type === 'announcement') return <Megaphone size={17} aria-hidden="true" />;
  return <Hash size={17} aria-hidden="true" />;
}

/** Scrollable server rail, with each server named for screen readers and hover users. */
export function GuildNavigation() {
  const { t } = useTranslation();
  const guilds = useGuilds();
  const { guildId } = useParams({ strict: false });
  return (
    <>
      <div className={styles['railServers']}>
        {(guilds.data?.items ?? []).map((guild) => (
          <Link
            key={guild.id}
            to="/app/guilds/$guildId"
            params={{ guildId: guild.id }}
            className={styles['server']}
            title={guild.name}
            aria-label={guild.name}
            aria-current={guildId === guild.id ? 'page' : undefined}
          >
            {guildInitials(guild.name)}
          </Link>
        ))}
        {guilds.error ? (
          <span className={styles['railError']} role="alert" title={t(guildErrorKey(guilds.error))}>
            {t('guilds.unavailable')}
          </span>
        ) : null}
      </div>
      <GuildFormDialog
        trigger={(open) => (
          <IconButton label={t('guilds.createServer')} onClick={open}>
            <Plus size={22} />
          </IconButton>
        )}
      />
    </>
  );
}

/** A server's visible channels replace the conversation list while it is selected. */
export function GuildSidebar({ guildId }: { readonly guildId: string }) {
  const { t } = useTranslation();
  const guild = useGuild(guildId);
  const channels = useGuildChannels(guildId);
  const { channelId } = useParams({ strict: false });
  const data = guild.data;
  if (guild.error || channels.error)
    return (
      <p className={styles['error']} role="alert">
        {t(guildErrorKey(guild.error ?? channels.error))}
      </p>
    );
  if (!data || !channels.data)
    return <div className={styles['sidebar']} role="status" aria-label={t('guilds.loading')} />;
  const canRename = has(parsePermissions(data.permissions), Permission.MANAGE_GUILD);
  const canCreate = has(parsePermissions(data.permissions), Permission.MANAGE_CHANNELS);
  return (
    <div className={styles['sidebar']}>
      <header className={styles['sidebarHeader']}>
        <Link to="/app/guilds/$guildId" params={{ guildId }} className={styles['serverTitle']}>
          {data.name}
        </Link>
        {canRename ? (
          <GuildFormDialog
            guild={data}
            trigger={(open) => (
              <IconButton label={t('guilds.renameServer')} onClick={open}>
                <PencilSimple size={16} />
              </IconButton>
            )}
          />
        ) : null}
      </header>
      <div className={styles['channelHeading']}>
        <h2>{t('guilds.channels')}</h2>
        {canCreate ? (
          <ChannelFormDialog
            guildId={guildId}
            channels={channels.data.items}
            trigger={(open) => (
              <IconButton label={t('guilds.createChannel')} onClick={open}>
                <Plus size={17} />
              </IconButton>
            )}
          />
        ) : null}
      </div>
      <nav className={styles['channelList']} aria-label={t('guilds.channels')}>
        {orderedGuildChannels(channels.data.items).map((channel) => (
          <Link
            key={channel.id}
            to="/app/guilds/$guildId/channels/$channelId"
            params={{ guildId, channelId: channel.id }}
            className={styles['channel']}
            data-child={channel.parentId !== null || undefined}
            aria-current={channelId === channel.id ? 'page' : undefined}
          >
            <ChannelIcon type={channel.type} />
            <span>{channel.name}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
