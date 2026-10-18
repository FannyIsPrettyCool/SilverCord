import { SignOut, UserPlus, Users } from '@phosphor-icons/react';
import type { Channel } from '@silvercord/protocol';
import { Glass, IconButton } from '@silvercord/ui';
import { useNavigate, useParams } from '@tanstack/react-router';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { useChannel, useChannelMembers } from '../../api/chat.ts';
import { usePresence, useTyping } from '../../api/presence.ts';
import { useRelationships } from '../../api/social.ts';
import { useSession } from '../../session/session-store.ts';
import { Avatar, displayName } from '../presence/Avatar.tsx';
import { ProfileTrigger } from '../profiles/ProfilePopover.tsx';
import { Popover } from '../shell/Popover.tsx';
import { Composer } from './Composer.tsx';
import { channelTitle, peers } from './channel-name.ts';
import styles from './channel-view.module.css';
import { type Density, useChatState } from './chat-state.ts';
import { errorKey } from './error-key.ts';
import { MessageList } from './MessageList.tsx';

function DensitySwitch({ allowBubble }: { readonly allowBubble: boolean }) {
  const { t } = useTranslation();
  const density = useChatState((s) => s.density);
  const setDensity = useChatState((s) => s.setDensity);
  const options: Density[] = allowBubble ? ['cozy', 'compact', 'bubble'] : ['cozy', 'compact'];
  const current = density === 'bubble' && !allowBubble ? 'cozy' : density;
  return (
    <fieldset className={styles['segmented']} aria-label={t('chat.density.label')}>
      {options.map((option) => (
        <label
          key={option}
          className={styles['segment']}
          data-checked={current === option || undefined}
        >
          <input
            type="radio"
            name="density"
            value={option}
            checked={current === option}
            onChange={() => setDensity(option)}
          />
          {current === option ? (
            <motion.span
              layoutId="density-pill"
              className={styles['segmentPill']}
              transition={{ type: 'spring', stiffness: 480, damping: 32 }}
            />
          ) : null}
          <span className={styles['segmentLabel']}>{t(`chat.density.${option}`)}</span>
        </label>
      ))}
    </fieldset>
  );
}

function GroupMembers({ channel }: { readonly channel: Channel }) {
  const { t } = useTranslation();
  const selfId = useSession((s) => s.user?.id);
  const friends = useRelationships('friends');
  const members = useChannelMembers(channel.id);
  const navigate = useNavigate();
  const statusOf = usePresence(channel.members.map((member) => member.id));
  const memberIds = new Set(channel.members.map((member) => member.id));
  const candidates = (friends.data ?? []).filter((friend) => !memberIds.has(friend.user.id));
  return (
    <div className={styles['members']}>
      <ul className={styles['memberList']}>
        {channel.members.map((member) => (
          <li key={member.id}>
            <ProfileTrigger user={member} className={styles['member']}>
              <Avatar user={member} size={28} status={statusOf(member.id)} />
              <span>{displayName(member)}</span>
            </ProfileTrigger>
          </li>
        ))}
      </ul>
      {candidates.length > 0 ? (
        <>
          <h3 className={styles['membersHeading']}>{t('chat.addMember')}</h3>
          <p className={styles['note']}>{t('chat.historyVisible')}</p>
          <ul className={styles['memberList']}>
            {candidates.map((friend) => (
              <li key={friend.user.id}>
                <button
                  type="button"
                  className={styles['member']}
                  onClick={() => members.add.mutate(friend.user.id)}
                >
                  <UserPlus size={16} weight="duotone" aria-hidden="true" />
                  <span>{displayName(friend.user)}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {members.add.isError ? (
        <p className={styles['error']} role="alert">
          {t(errorKey(members.add.error))}
        </p>
      ) : null}
      <button
        type="button"
        className={styles['leave']}
        onClick={async () => {
          if (!selfId) return;
          await members.remove.mutateAsync(selfId);
          await navigate({ to: '/app' });
        }}
      >
        <SignOut size={16} weight="duotone" aria-hidden="true" />
        {t('chat.leaveGroup')}
      </button>
    </div>
  );
}

function TypingIndicator({ channel }: { readonly channel: Channel }) {
  const { t } = useTranslation();
  const typing = useTyping(channel.id);
  const names = typing.flatMap((id) => {
    const member = channel.members.find((candidate) => candidate.id === id);
    return member ? [displayName(member)] : [];
  });
  return (
    <div className={styles['typing']} aria-live="polite">
      {names.length === 1 ? (
        <>
          <span className={styles['dots']} aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          {t('chat.typingOne', { name: names[0] })}
        </>
      ) : names.length > 1 ? (
        <>
          <span className={styles['dots']} aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          {t('chat.typingMany', { count: names.length })}
        </>
      ) : null}
    </div>
  );
}

/** A DM or group: header, virtualized history, typing line and composer. */
export function ChannelView() {
  const { t } = useTranslation();
  const { channelId } = useParams({ from: '/app/channels/$channelId' });
  const selfId = useSession((s) => s.user?.id);
  const channel = useChannel(channelId);
  const peer = channel.data?.type === 'dm' ? peers(channel.data, selfId)[0] : undefined;
  const statusOf = usePresence(peer ? [peer.id] : []);

  if (channel.isError) {
    return (
      <div className={styles['missing']} role="alert">
        {t(errorKey(channel.error))}
      </div>
    );
  }
  if (!channel.data) return <div className={styles['view']} />;
  const data = channel.data;
  const title = channelTitle(data, selfId);

  return (
    <section className={styles['view']} aria-label={title}>
      <Glass as="header" level={1} className={styles['header']}>
        {peer ? (
          <ProfileTrigger user={peer} label={displayName(peer)}>
            <Avatar user={peer} size={28} status={statusOf(peer.id)} />
          </ProfileTrigger>
        ) : (
          <Users size={22} weight="duotone" aria-hidden="true" />
        )}
        <h1 className={styles['title']}>{title}</h1>
        {data.type === 'group_dm' ? (
          <span className={styles['count']}>{data.members.length}</span>
        ) : null}
        <span className={styles['spacer']} />
        <DensitySwitch allowBubble={data.type === 'dm'} />
        {data.type === 'group_dm' ? (
          <Popover
            placement="bottom-end"
            trigger={({ toggle, ...aria }) => (
              <IconButton label={t('chat.members')} onClick={toggle} {...aria}>
                <Users size={18} weight="duotone" />
              </IconButton>
            )}
          >
            {() => <GroupMembers channel={data} />}
          </Popover>
        ) : null}
      </Glass>
      <MessageList key={data.id} channel={data} />
      <TypingIndicator channel={data} />
      <Composer key={data.id} channel={data} placeholder={t('chat.messageTo', { name: title })} />
    </section>
  );
}
