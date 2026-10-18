import { Plus, UsersThree } from '@phosphor-icons/react';
import { IconButton } from '@silvercord/ui';
import { Link, useParams } from '@tanstack/react-router';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { useChannels } from '../../api/chat.ts';
import { usePresence } from '../../api/presence.ts';
import { useRelationships } from '../../api/social.ts';
import { useSession } from '../../session/session-store.ts';
import { Avatar } from '../presence/Avatar.tsx';
import { channelTitle, peers } from './channel-name.ts';
import styles from './conversation-list.module.css';
import { NewGroupDialog } from './NewGroupDialog.tsx';

function Badge({ count, mention }: { readonly count: number; readonly mention?: boolean }) {
  if (count <= 0) return null;
  return (
    <span className={styles['badge']} data-mention={mention || undefined}>
      {count >= 100 ? '99+' : count}
    </span>
  );
}

/** Sidebar: Friends entry plus DMs and groups by latest activity. */
export function ConversationList() {
  const { t } = useTranslation();
  const selfId = useSession((s) => s.user?.id);
  const channels = useChannels();
  const incoming = useRelationships('incoming');
  const params = useParams({ strict: false });
  const activeId = 'channelId' in params ? params.channelId : undefined;
  const dmPeers = (channels.data ?? []).flatMap((channel) =>
    channel.type === 'dm' ? peers(channel, selfId).map((peer) => peer.id) : [],
  );
  const statusOf = usePresence(dmPeers);

  return (
    <nav className={styles['list']} aria-label={t('chat.conversations')}>
      <Link
        to="/app"
        className={styles['row']}
        activeOptions={{ exact: true }}
        activeProps={{ 'aria-current': 'page' }}
      >
        <span className={styles['icon']} aria-hidden="true">
          <UsersThree size={20} weight="duotone" />
        </span>
        <span className={styles['name']}>{t('social.friends')}</span>
        <Badge count={incoming.data?.length ?? 0} mention />
      </Link>
      <div className={styles['section']}>
        <h2 className={styles['heading']}>{t('chat.directMessages')}</h2>
        <NewGroupDialog
          trigger={(open) => (
            <IconButton label={t('chat.newGroup')} onClick={open} className={styles['add']}>
              <Plus size={14} weight="bold" />
            </IconButton>
          )}
        />
      </div>
      <ul className={styles['channels']}>
        {(channels.data ?? []).map((channel) => {
          const others = peers(channel, selfId);
          const first = others[0];
          const unread = channel.readState.unreadCount;
          return (
            <motion.li
              key={channel.id}
              layout="position"
              transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            >
              <Link
                to="/app/channels/$channelId"
                params={{ channelId: channel.id }}
                className={styles['row']}
                data-unread={unread > 0 || undefined}
                aria-current={channel.id === activeId ? 'page' : undefined}
              >
                {channel.type === 'dm' && first ? (
                  <Avatar user={first} size={32} status={statusOf(first.id)} />
                ) : (
                  <span className={styles['groupIcon']} aria-hidden="true">
                    {others.length + 1}
                  </span>
                )}
                <span className={styles['name']}>{channelTitle(channel, selfId)}</span>
                <Badge
                  count={channel.readState.mentionCount || unread}
                  mention={channel.readState.mentionCount > 0}
                />
              </Link>
            </motion.li>
          );
        })}
      </ul>
    </nav>
  );
}
