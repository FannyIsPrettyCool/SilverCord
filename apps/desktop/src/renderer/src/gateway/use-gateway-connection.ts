import { currentUserSchema } from '@silvercord/protocol';
import { useEffect } from 'react';
import { create } from 'zustand';
import { isCurrentAccountGeneration, requireAccountGeneration } from '../api/account-generation.ts';
import { handleDispatch, reconcile } from '../api/sync.ts';
import { desktop, unwrap } from '../desktop.ts';
import { useSession } from '../session/session-store.ts';
import { createGatewayClient, type GatewayState } from './gateway-client.ts';

export const useGatewayState = create<{ state: GatewayState }>()(() => ({ state: 'idle' }));

/** Keeps one gateway connection alive while signed in and routes dispatches into stores. */
export function useGatewayConnection(): void {
  const status = useSession((s) => s.status);
  const generation = useSession((s) => s.accountGeneration);

  useEffect(() => {
    if (status !== 'signed-in') return;
    let cancelled = false;
    const current = () => !cancelled && isCurrentAccountGeneration(generation);
    let stop: (() => void) | undefined;
    void unwrap(desktop().config())
      .then((config) => {
        if (!current()) return;
        const client = createGatewayClient({
          url: config.gatewayUrl,
          client: { name: 'desktop', version: config.version, os: config.platform },
          getToken: async () => {
            requireAccountGeneration(generation);
            const snapshot = await unwrap(desktop().auth.accessToken());
            requireAccountGeneration(generation);
            return snapshot.accessToken;
          },
          onState: (state) => {
            if (current()) useGatewayState.setState({ state });
          },
          onDispatch: (t, d) => {
            if (!current()) return;
            if (t === 'READY' || t === 'RESUMED') reconcile(true);
            handleDispatch(t, d);
            if (t === 'READY' || t === 'USER_UPDATE') {
              const user = currentUserSchema.safeParse(
                t === 'READY' ? (d as { user?: unknown }).user : d,
              );
              if (user.success) useSession.getState().updateUser(user.data);
            }
          },
          onUnauthenticated: () => {
            if (current()) void useSession.getState().signOut();
          },
        });
        client.start();
        const onFocus = () => {
          if (current()) reconcile(true);
        };
        window.addEventListener('focus', onFocus);
        const timer = setInterval(() => {
          if (current()) reconcile();
        }, 30_000);
        stop = () => {
          client.stop();
          window.removeEventListener('focus', onFocus);
          clearInterval(timer);
        };
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      stop?.();
      useGatewayState.setState({ state: 'idle' });
    };
  }, [status, generation]);
}
