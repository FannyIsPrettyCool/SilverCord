import { SignOut } from '@phosphor-icons/react';
import { Glass, IconButton } from '@silvercord/ui';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import mark from '../../assets/mark.svg';
import { useGatewayState } from '../../gateway/use-gateway-connection.ts';
import { useSession } from '../../session/session-store.ts';
import styles from './app-shell.module.css';

function ConnectionLabel({ state }: { readonly state: string }) {
  const { t } = useTranslation();
  if (state === 'ready') return <>{t('connection.connected')}</>;
  if (state === 'connecting' || state === 'idle') return <>{t('connection.connecting')}</>;
  return <>{t('connection.offline')}</>;
}

/** Phase 1 shell: navigation scaffolding plus the live gateway state (docs/spec/auth-screens.md). */
export function AppShell() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useSession((s) => s.user);
  const persistent = useSession((s) => s.persistent);
  const signOut = useSession((s) => s.signOut);
  const gateway = useGatewayState((s) => s.state);
  if (!user) return null;
  const name = user.displayName ?? user.username;

  return (
    <div className={styles['shell']}>
      <nav className={styles['rail']} aria-label={t('shell.home')}>
        <button
          type="button"
          className={styles['railItem']}
          aria-current="page"
          aria-label={t('shell.home')}
        >
          <span className={styles['railPill']} aria-hidden="true" />
          <img className={styles['railMark']} src={mark} alt="" />
        </button>
      </nav>
      <Glass as="aside" level={2} className={styles['sidebar']}>
        <div className={styles['sidebarBody']} />
        {persistent ? null : <p className={styles['note']}>{t('session.notRemembered')}</p>}
        <div className={styles['userPanel']}>
          <div className={styles['avatar']} aria-hidden="true">
            {name.slice(0, 1).toUpperCase()}
            <span className={styles['presence']} data-state={gateway} />
          </div>
          <div className={styles['identity']}>
            <span className={styles['displayName']}>{name}</span>
            <span className={styles['status']} role="status" aria-live="polite">
              <ConnectionLabel state={gateway} />
            </span>
          </div>
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
      <main className={styles['content']} />
    </div>
  );
}
