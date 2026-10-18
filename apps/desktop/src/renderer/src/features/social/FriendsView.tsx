import { ChatCircle, Check, Prohibit, UserMinus, X } from '@phosphor-icons/react';
import type { RelationshipKind, RelationshipView } from '@silvercord/protocol';
import { Button, Glass, IconButton } from '@silvercord/ui';
import { useNavigate } from '@tanstack/react-router';
import { motion } from 'motion/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useOpenChannel } from '../../api/chat.ts';
import { usePresence } from '../../api/presence.ts';
import { useRelationshipAction, useRelationships, useSendFriendRequest } from '../../api/social.ts';
import { errorKey } from '../chat/error-key.ts';
import { Avatar, displayName } from '../presence/Avatar.tsx';
import styles from './friends.module.css';

type Tab = 'online' | 'all' | 'pending' | 'blocked';
const TABS: readonly Tab[] = ['online', 'all', 'pending', 'blocked'];

function AddFriend() {
  const { t } = useTranslation();
  const [username, setUsername] = useState('');
  const send = useSendFriendRequest();
  return (
    <form
      className={styles['add']}
      onSubmit={async (event) => {
        event.preventDefault();
        if (!username.trim()) return;
        await send.mutateAsync(username.trim()).then(
          () => setUsername(''),
          () => undefined,
        );
      }}
    >
      <label className={styles['addLabel']} htmlFor="add-friend">
        {t('social.addFriend')}
      </label>
      <div className={styles['addRow']}>
        <input
          id="add-friend"
          className={styles['addInput']}
          value={username}
          autoComplete="off"
          spellCheck={false}
          maxLength={32}
          placeholder={t('social.usernamePlaceholder')}
          aria-invalid={send.isError || undefined}
          aria-describedby={send.isError ? 'add-friend-error' : undefined}
          onChange={(event) => {
            setUsername(event.target.value);
            send.reset();
          }}
        />
        <Button type="submit" loading={send.isPending} disabled={!username.trim()}>
          {t('social.send')}
        </Button>
      </div>
      {send.isError ? (
        <p id="add-friend-error" className={styles['error']} role="alert">
          {t(errorKey(send.error))}
        </p>
      ) : send.isSuccess ? (
        <p className={styles['sent']} role="status">
          {t('social.requestSent')}
        </p>
      ) : null}
    </form>
  );
}

function Row({
  relationship,
  status,
}: {
  readonly relationship: RelationshipView;
  readonly status: ReturnType<ReturnType<typeof usePresence>>;
}) {
  const { t } = useTranslation();
  const action = useRelationshipAction();
  const openChannel = useOpenChannel();
  const navigate = useNavigate();
  const { user, kind } = relationship;
  const name = relationship.metadata.nickname ?? displayName(user);
  const act = (type: 'accept' | 'remove' | 'block' | 'unblock') =>
    action.mutate({ action: type, userId: user.id });

  return (
    <motion.li
      layout="position"
      className={styles['row']}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 420, damping: 32 }}
    >
      <Avatar user={user} size={36} status={kind === 'friends' ? status : undefined} />
      <span className={styles['identity']}>
        <span className={styles['name']}>{name}</span>
        <span className={styles['handle']}>@{user.username}</span>
      </span>
      <span className={styles['actions']}>
        {kind === 'friends' ? (
          <>
            <IconButton
              label={t('social.message')}
              onClick={async () => {
                const channel = await openChannel.mutateAsync({ recipientId: user.id });
                await navigate({
                  to: '/app/channels/$channelId',
                  params: { channelId: channel.id },
                });
              }}
            >
              <ChatCircle size={18} weight="duotone" />
            </IconButton>
            <IconButton label={t('social.remove')} onClick={() => act('remove')}>
              <UserMinus size={18} weight="duotone" />
            </IconButton>
            <IconButton label={t('social.block')} onClick={() => act('block')}>
              <Prohibit size={18} weight="duotone" />
            </IconButton>
          </>
        ) : null}
        {kind === 'incoming' ? (
          <>
            <IconButton label={t('social.accept')} onClick={() => act('accept')}>
              <Check size={18} weight="bold" />
            </IconButton>
            <IconButton label={t('social.decline')} onClick={() => act('remove')}>
              <X size={18} weight="bold" />
            </IconButton>
          </>
        ) : null}
        {kind === 'outgoing' ? (
          <IconButton label={t('social.cancel')} onClick={() => act('remove')}>
            <X size={18} weight="bold" />
          </IconButton>
        ) : null}
        {kind === 'blocked' ? (
          <Button variant="quiet" onClick={() => act('unblock')}>
            {t('social.unblock')}
          </Button>
        ) : null}
      </span>
    </motion.li>
  );
}

/** Friends, requests and blocks (docs/spec/relationships.md). */
export function FriendsView() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('online');
  const lists: Record<RelationshipKind, ReturnType<typeof useRelationships>> = {
    friends: useRelationships('friends'),
    incoming: useRelationships('incoming'),
    outgoing: useRelationships('outgoing'),
    blocked: useRelationships('blocked'),
  };
  const friends = lists.friends.data ?? [];
  const statusOf = usePresence(friends.map((friend) => friend.user.id));
  const pending = [...(lists.incoming.data ?? []), ...(lists.outgoing.data ?? [])];
  const visible =
    tab === 'online'
      ? friends.filter((friend) => statusOf(friend.user.id) !== 'offline')
      : tab === 'all'
        ? friends
        : tab === 'pending'
          ? pending
          : (lists.blocked.data ?? []);
  const counts: Record<Tab, number> = {
    online: friends.filter((friend) => statusOf(friend.user.id) !== 'offline').length,
    all: friends.length,
    pending: pending.length,
    blocked: lists.blocked.data?.length ?? 0,
  };

  return (
    <section className={styles['view']} aria-labelledby="friends-title">
      <Glass as="header" level={1} className={styles['header']}>
        <h1 id="friends-title" className={styles['title']}>
          {t('social.friends')}
        </h1>
        <div className={styles['tabs']} role="tablist" aria-label={t('social.friends')}>
          {TABS.map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              className={styles['tab']}
              onClick={() => setTab(value)}
            >
              {tab === value ? (
                <motion.span
                  layoutId="friends-tab"
                  className={styles['tabPill']}
                  transition={{ type: 'spring', stiffness: 480, damping: 32 }}
                />
              ) : null}
              <span className={styles['tabLabel']}>{t(`social.tabs.${value}`)}</span>
              <span className={styles['tabCount']}>{counts[value]}</span>
            </button>
          ))}
        </div>
      </Glass>
      <div className={styles['body']}>
        <AddFriend />
        <ul className={styles['list']} role="tabpanel">
          {visible.map((relationship) => (
            <Row
              key={`${relationship.kind}-${relationship.user.id}`}
              relationship={relationship}
              status={statusOf(relationship.user.id)}
            />
          ))}
        </ul>
      </div>
    </section>
  );
}
