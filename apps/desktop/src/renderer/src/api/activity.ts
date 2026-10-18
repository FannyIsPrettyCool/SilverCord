import {
  ACTIVITY_REFRESH_MS,
  type ActivityInput,
  type ActivitySources,
  type DetectedSource,
  ownActivitySchema,
} from '@silvercord/protocol';
import { useMutation, useQuery } from '@tanstack/react-query';
import { desktop, unwrap } from '../desktop.ts';
import { api, apiVoid } from './api-client.ts';
import { keys, queryClient } from './query-client.ts';

export function useOwnActivity() {
  return useQuery({
    queryKey: keys.ownActivity,
    queryFn: () => api(ownActivitySchema, '/api/v1/users/@me/activity'),
  });
}

export function useSetActivitySources() {
  return useMutation({
    mutationFn: (sources: ActivitySources) =>
      api(ownActivitySchema, '/api/v1/users/@me/activity/sources', {
        method: 'PUT',
        body: sources,
      }),
    onSuccess: (own) => queryClient.setQueryData(keys.ownActivity, own),
  });
}

export function useSetManualActivity() {
  return useMutation({
    mutationFn: (input: { activity: ActivityInput; expiresAt: string | null } | null) =>
      input
        ? apiVoid('/api/v1/users/@me/activity/manual', { method: 'PUT', body: input })
        : apiVoid('/api/v1/users/@me/activity/manual', { method: 'DELETE' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.ownActivity }),
  });
}

const DETECTED: readonly DetectedSource[] = ['game', 'rpc', 'media'];

/**
 * Relays what main detected to the API: on change, again every minute while it lasts (the
 * server forgets entries after 150 s), and a delete when it ends. Returns a stop function.
 */
export function startActivityRelay(options: {
  readonly onRequests: (clients: readonly string[]) => void;
  readonly intervalMs?: number;
}): () => void {
  const sent = new Map<DetectedSource, { key: string; at: number }>();
  let stopped = false;
  let busy = false;

  async function tick() {
    if (busy || stopped) return;
    busy = true;
    try {
      const snapshot = await unwrap(desktop().activity.snapshot());
      options.onRequests(snapshot.rpcRequests);
      for (const source of DETECTED) {
        const activity = snapshot[source];
        const previous = sent.get(source);
        const key = JSON.stringify(activity);
        if (activity) {
          if (previous?.key === key && Date.now() - previous.at < ACTIVITY_REFRESH_MS) continue;
          await apiVoid(`/api/v1/users/@me/activity/${source}`, {
            method: 'PUT',
            body: { activity },
          });
          sent.set(source, { key, at: Date.now() });
        } else if (previous) {
          sent.delete(source);
          await apiVoid(`/api/v1/users/@me/activity/${source}`, { method: 'DELETE' });
        }
      }
    } catch {
      // Offline or a source was switched off meanwhile: the next tick retries from scratch.
      sent.clear();
    } finally {
      busy = false;
    }
  }

  void tick();
  const timer = setInterval(() => void tick(), options.intervalMs ?? 5_000);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
