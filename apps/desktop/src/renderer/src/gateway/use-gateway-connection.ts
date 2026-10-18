import { currentUserSchema } from '@silvercord/protocol';
import { useEffect } from 'react';
import { create } from 'zustand';
import { handleDispatch, reconcile } from '../api/sync.ts';
import { desktop, unwrap } from '../desktop.ts';
import { useSession } from '../session/session-store.ts';
import { createGatewayClient, type GatewayState } from './gateway-client.ts';

export const useGatewayState = create<{ state: GatewayState }>()(() => ({ state: 'idle' }));

/** Keeps one gateway connection alive while signed in and routes dispatches into stores. */
export function useGatewayConnection(): void {
  const status = useSession((s) => s.status);

  useEffect(() => {
    if (status !== 'signed-in') return;
    let cancelled = false;
    let stop: (() => void) | undefined;
    void unwrap(desktop().config()).then((config) => {
      if (cancelled) return;
      const client = createGatewayClient({
        url: config.gatewayUrl,
        client: { name: 'desktop', version: config.version, os: config.platform },
        getToken: async () => (await unwrap(desktop().auth.accessToken())).accessToken,
        onState: (state) => useGatewayState.setState({ state }),
        onDispatch: (t, d) => {
          if (t === 'READY' || t === 'RESUMED') reconcile();
          handleDispatch(t, d);
          if (t === 'READY' || t === 'USER_UPDATE') {
            const user = currentUserSchema.safeParse(
              t === 'READY' ? (d as { user?: unknown }).user : d,
            );
            if (user.success) useSession.getState().updateUser(user.data);
          }
        },
        onUnauthenticated: () => void useSession.getState().signOut(),
      });
      client.start();
      const onFocus = () => reconcile();
      window.addEventListener('focus', onFocus);
      const timer = setInterval(reconcile, 30_000);
      stop = () => {
        client.stop();
        window.removeEventListener('focus', onFocus);
        clearInterval(timer);
      };
    });
    return () => {
      cancelled = true;
      stop?.();
      useGatewayState.setState({ state: 'idle' });
    };
  }, [status]);
}
