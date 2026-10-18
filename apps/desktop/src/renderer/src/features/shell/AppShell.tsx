import { PencilSimple, SignOut, Smiley } from '@phosphor-icons/react';
import { Glass, IconButton } from '@silvercord/ui';
import { Link, Outlet, useNavigate, useParams } from '@tanstack/react-router';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useOwnPresence } from '../../api/presence.ts';
import { useOwnProfile } from '../../api/profiles.ts';
import mark from '../../assets/mark.svg';
import { useGatewayState } from '../../gateway/use-gateway-connection.ts';
import { useSession } from '../../session/session-store.ts';
import { ConversationList } from '../chat/ConversationList.tsx';
import { GuildNavigation, GuildSidebar } from '../guilds/GuildNavigation.tsx';
import { Avatar } from '../presence/Avatar.tsx';
import { StatusMenu } from '../presence/StatusMenu.tsx';
import { ActivityRelay } from '../profiles/ActivityRelay.tsx';
import { CustomStatusDialog } from '../profiles/CustomStatusDialog.tsx';
import { StatusLine } from '../profiles/ProfileCard.tsx';
import { ProfileDialog } from '../profiles/ProfileDialog.tsx';
import styles from './app-shell.module.css';
import { Popover } from './Popover.tsx';

function ConnectionLabel({ state }: { readonly state: string }) {
  const { t } = useTranslation();
  if (state === 'ready') return <>{t('connection.connected')}</>;
  if (state === 'connecting' || state === 'idle') return <>{t('connection.connecting')}</>;
  return <>{t('connection.offline')}</>;
}

/** Chat layout: rail, conversations sidebar with the user panel, and the routed content. */
export function AppShell() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { guildId } = useParams({ strict: false });
  const user = useSession((s) => s.user);
  const persistent = useSession((s) => s.persistent);
  const signOut = useSession((s) => s.signOut);
  const gateway = useGatewayState((s) => s.state);
  const own = useOwnPresence();
  const profile = useOwnProfile();
  const openStatus = useRef<(() => void) | null>(null);
  if (!user) return null;
  const customStatus = profile.data?.customStatus ?? null;
  const name = user.displayName ?? user.username;
  const status =
    gateway !== 'ready'
      ? 'offline'
      : own.data?.status === 'invisible'
        ? 'offline'
        : (own.data?.status ?? 'online');

  return (
    <div className={styles['shell']}>
      <nav className={styles['rail']} aria-label={t('shell.home')}>
        <Link
          to="/app"
          className={styles['railItem']}
          activeOptions={{ exact: true }}
          aria-current={guildId ? undefined : 'page'}
          aria-label={t('shell.home')}
        >
          <span className={styles['railPill']} aria-hidden="true" />
          <img className={styles['railMark']} src={mark} alt="" />
        </Link>
        <GuildNavigation />
      </nav>
      <Glass as="aside" level={2} className={styles['sidebar']}>
        {guildId ? <GuildSidebar key={guildId} guildId={guildId} /> : <ConversationList />}
        {persistent ? null : <p className={styles['note']}>{t('session.notRemembered')}</p>}
        <div className={styles['userPanel']}>
          <Popover
            trigger={({ toggle, ...aria }) => (
              <button
                type="button"
                className={styles['identityButton']}
                onClick={toggle}
                aria-label={t('presence.title')}
                {...aria}
              >
                <Avatar user={user} size={36} status={status} />
                <span className={styles['identity']}>
                  <span className={styles['displayName']}>{name}</span>
                  <span className={styles['status']} role="status" aria-live="polite">
                    {gateway === 'ready' && customStatus ? (
                      <StatusLine status={customStatus} />
                    ) : (
                      <ConnectionLabel state={gateway} />
                    )}
                  </span>
                </span>
              </button>
            )}
          >
            {(close) => (
              <div className={styles['menu']}>
                <StatusMenu />
                <div className={styles['menuActions']}>
                  <button
                    type="button"
                    className={styles['menuItem']}
                    onClick={() => {
                      close();
                      openStatus.current?.();
                    }}
                  >
                    <Smiley size={16} weight="duotone" aria-hidden="true" />
                    {customStatus ? t('customStatus.edit') : t('customStatus.set')}
                  </button>
                  <button
                    type="button"
                    className={styles['menuItem']}
                    onClick={async () => {
                      close();
                      await navigate({
                        to: '/app/settings/$section',
                        params: { section: 'profile' },
                      });
                    }}
                  >
                    <PencilSimple size={16} weight="duotone" aria-hidden="true" />
                    {t('profile.edit')}
                  </button>
                </div>
              </div>
            )}
          </Popover>
          <IconButton
            label={t('shell.signOut')}
            onClick={async () => {
              await signOut();
              await navigate({ to: '/sign-in' });
            }}
          >
            <SignOut size={18} weight="duotone" />
          </IconButton>
        </div>
      </Glass>
      <main className={styles['content']}>
        <Outlet />
      </main>
      <ProfileDialog />
      <ActivityRelay />
      {/* Outside the popover, which unmounts on close; the menu opens it through the ref. */}
      <CustomStatusDialog
        trigger={(open) => {
          openStatus.current = open;
          return null;
        }}
      />
    </div>
  );
}
