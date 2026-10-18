import { Button, Glass } from '@silvercord/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { startActivityRelay, useOwnActivity } from '../../api/activity.ts';
import { keys } from '../../api/query-client.ts';
import { desktop, unwrap } from '../../desktop.ts';
import styles from '../chat/dialog.module.css';

/**
 * Runs while signed in: tells main which detectors may run (the server's switches), relays
 * their findings, and asks the user about programs that want to use Local RPC.
 */
export function ActivityRelay() {
  const { t } = useTranslation();
  const own = useOwnActivity();
  const queryClient = useQueryClient();
  const [requests, setRequests] = useState<readonly string[]>([]);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const sources = own.data?.sources;
  const detecting = sources ? sources.game || sources.rpc || sources.media : false;

  useEffect(() => {
    if (!sources) return;
    const switches = { game: sources.game, rpc: sources.rpc, media: sources.media };
    void unwrap(desktop().activity.configure(switches)).catch(() => undefined);
  }, [sources]);

  // Detectors stop when the account signs out or the shell goes away.
  useEffect(
    () => () => {
      void unwrap(desktop().activity.configure({ game: false, rpc: false, media: false })).catch(
        () => undefined,
      );
    },
    [],
  );

  useEffect(() => {
    if (!detecting) return;
    return startActivityRelay({
      onRequests: (clients) =>
        setRequests((current) => (current.join('\n') === clients.join('\n') ? current : clients)),
    });
  }, [detecting]);

  const pending = requests[0];
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (pending && !element.open) element.showModal();
    if (!pending && element.open) element.close();
  }, [pending]);

  const decide = async (allow: boolean) => {
    if (!pending) return;
    setRequests((current) => current.filter((client) => client !== pending));
    await unwrap(desktop().activity.decide({ client: pending, allow })).catch(() => undefined);
    await queryClient.invalidateQueries({ queryKey: keys.rpcApps });
  };

  return (
    <dialog
      ref={dialog}
      className={styles['dialog']}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        void decide(false);
      }}
    >
      <Glass level={3} className={styles['panel']}>
        <div className={styles['form']}>
          <h2 id={titleId} className={styles['title']}>
            {t('activity.requestTitle', { app: pending ?? '' })}
          </h2>
          <div className={styles['actions']}>
            <Button variant="quiet" onClick={() => void decide(false)}>
              {t('activity.deny')}
            </Button>
            <Button onClick={() => void decide(true)}>{t('activity.allow')}</Button>
          </div>
        </div>
      </Glass>
    </dialog>
  );
}
