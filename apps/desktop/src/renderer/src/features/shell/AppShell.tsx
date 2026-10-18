import { SignOut } from '@phosphor-icons/react';
import { Glass, IconButton } from '@silvercord/ui';
import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useOwnPresence } from '../../api/presence.ts';
import mark from '../../assets/mark.svg';
import { useGatewayState } from '../../gateway/use-gateway-connection.ts';
import { useSession } from '../../session/session-store.ts';
import { ConversationList } from '../chat/ConversationList.tsx';
import { Avatar } from '../presence/Avatar.tsx';
import { StatusMenu } from '../presence/StatusMenu.tsx';
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
  const user = useSession((s) => s.user);
  const persistent = useSession((s) => s.persistent);
  const signOut = useSession((s) => s.signOut);
  const gateway = useGatewayState((s) => s.state);
  const own = useOwnPresence();
  if (!user) return null;
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
          activeProps={{ 'aria-current': 'page' }}
          aria-label={t('shell.home')}
        >
          <span className={styles['railPill']} aria-hidden="true" />
          <img className={styles['railMark']} src={mark} alt="" />
        </Link>
      </nav>
      <Glass as="aside" level={2} className={styles['sidebar']}>
        <ConversationList />
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
                    <ConnectionLabel state={gateway} />
                  </span>
                </span>
              </button>
            )}
          >
            {() => <StatusMenu />}
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
    </div>
  );
}
