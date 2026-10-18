import { X } from '@phosphor-icons/react';
import { Glass, IconButton } from '@silvercord/ui';
import { Link } from '@tanstack/react-router';
import { motion } from 'motion/react';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useGuilds } from '../../api/guilds.ts';
import { usePresence } from '../../api/presence.ts';
import { useProfile, useSummary } from '../../api/profiles.ts';
import { useRelationships } from '../../api/social.ts';
import { Avatar, displayName } from '../presence/Avatar.tsx';
import styles from './dialog.module.css';
import { ProfileCard } from './ProfileCard.tsx';
import { cardFrom, useProfileView } from './profile-view.ts';

type Tab = 'about' | 'servers' | 'friends';

function Body({ userId, guildId }: { readonly userId: string; readonly guildId?: string }) {
  const { t } = useTranslation();
  const profile = useProfile(userId, guildId);
  const summary = useSummary(userId, guildId);
  const statusOf = usePresence([userId]);
  const guilds = useGuilds();
  const friends = useRelationships('friends');
  const close = useProfileView((s) => s.close);
  const [tab, setTab] = useState<Tab>('about');
  const tabsId = useId();
  const data = profile.data;
  if (!data) return null;
  const card = cardFrom(
    { id: data.userId, username: data.username, displayName: data.displayName },
    data,
    summary.data,
  );
  const mutualGuilds = new Set(data.mutualGuilds?.ids ?? []);
  const mutualFriends = new Set(data.mutualFriends?.ids ?? []);
  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'about', label: t('profile.about') },
  ];
  if (data.mutualGuilds)
    tabs.push({ id: 'servers', label: t('profile.mutualServers'), count: data.mutualGuilds.count });
  if (data.mutualFriends)
    tabs.push({
      id: 'friends',
      label: t('profile.mutualFriends'),
      count: data.mutualFriends.count,
    });

  return (
    <ProfileCard card={card} size="full" presence={statusOf(userId)}>
      <div role="tablist" aria-label={t('profile.tabs')} className={styles['tabs']}>
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`${tabsId}-${item.id}`}
            aria-selected={tab === item.id}
            aria-controls={`${tabsId}-panel`}
            className={styles['tab']}
            onClick={() => setTab(item.id)}
          >
            {tab === item.id ? (
              <motion.span
                layoutId={`${tabsId}-pill`}
                className={styles['tabPill']}
                transition={{ type: 'spring', stiffness: 420, damping: 32, mass: 0.8 }}
              />
            ) : null}
            <span className={styles['tabLabel']}>{item.label}</span>
            {item.count !== undefined ? (
              <span className={styles['tabCount']}>{item.count}</span>
            ) : null}
          </button>
        ))}
      </div>
      <div
        id={`${tabsId}-panel`}
        role="tabpanel"
        aria-labelledby={`${tabsId}-${tab}`}
        className={styles['panelBody']}
      >
        {tab === 'about' && data.note ? (
          <dl className={styles['facts']}>
            <dt>{t('profile.note')}</dt>
            <dd className={styles['note']}>{data.note}</dd>
          </dl>
        ) : null}
        {tab === 'servers' ? (
          <ul className={styles['list']}>
            {(guilds.data?.items ?? [])
              .filter((guild) => mutualGuilds.has(guild.id))
              .map((guild) => (
                <li key={guild.id}>
                  <Link
                    to="/app/guilds/$guildId"
                    params={{ guildId: guild.id }}
                    className={styles['row']}
                    onClick={close}
                  >
                    <span className={styles['guildIcon']} aria-hidden="true">
                      {[...guild.name][0]?.toUpperCase()}
                    </span>
                    {guild.name}
                  </Link>
                </li>
              ))}
          </ul>
        ) : null}
        {tab === 'friends' ? (
          <ul className={styles['list']}>
            {(friends.data ?? [])
              .filter((friend) => mutualFriends.has(friend.user.id))
              .map((friend) => (
                <li key={friend.user.id} className={styles['row']}>
                  <Avatar user={friend.user} size={32} />
                  {friend.metadata.nickname ?? displayName(friend.user)}
                </li>
              ))}
          </ul>
        ) : null}
      </div>
    </ProfileCard>
  );
}

/** The full profile view: one modal for the whole shell, opened through `useProfileView`. */
export function ProfileDialog() {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const userId = useProfileView((s) => s.userId);
  const guildId = useProfileView((s) => s.guildId);
  const close = useProfileView((s) => s.close);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (userId && !element.open) element.showModal();
    if (!userId && element.open) element.close();
  }, [userId]);
  return (
    <dialog
      ref={dialog}
      className={styles['dialog']}
      aria-label={t('profile.viewFull')}
      onClose={close}
      onPointerDown={(event) => {
        // A press on the backdrop (the dialog element itself) closes it.
        if (event.target === event.currentTarget) close();
      }}
    >
      <Glass level={3} className={styles['glass']}>
        <IconButton className={styles['close']} label={t('profile.close')} onClick={close}>
          <X size={18} />
        </IconButton>
        {userId ? (
          <Body
            key={`${userId}-${guildId ?? ''}`}
            userId={userId}
            {...(guildId ? { guildId } : {})}
          />
        ) : null}
      </Glass>
    </dialog>
  );
}
