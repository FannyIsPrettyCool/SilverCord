import {
  type OwnPresence,
  ownPresenceSchema,
  type PresenceStatus,
  presenceSnapshotSchema,
  typingSnapshotSchema,
} from '@silvercord/protocol';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, apiVoid } from './api-client.ts';
import { keys, queryClient } from './query-client.ts';

const MAX_IDS = 100;

/** Statuses for the given users; anything the viewer may not see reads as offline. */
export function usePresence(userIds: readonly string[]) {
  const ids = [...new Set(userIds)].slice(0, MAX_IDS);
  const query = useQuery({
    queryKey: keys.presence(ids),
    enabled: ids.length > 0,
    queryFn: async () => {
      const snapshot = await api(
        presenceSnapshotSchema,
        `/api/v1/presence?userIds=${ids.join(',')}`,
      );
      return new Map(snapshot.items.map((item) => [item.userId, item.status]));
    },
    refetchInterval: 30_000,
  });
  return (userId: string): PresenceStatus => query.data?.get(userId) ?? 'offline';
}

export function useOwnPresence() {
  return useQuery({
    queryKey: keys.ownPresence,
    queryFn: () => api(ownPresenceSchema, '/api/v1/users/@me/presence'),
  });
}

export function useSetOwnPresence() {
  return useMutation({
    mutationFn: (status: OwnPresence['status']) =>
      api(ownPresenceSchema, '/api/v1/users/@me/presence', { method: 'PATCH', body: { status } }),
    onSuccess: (own) => queryClient.setQueryData(keys.ownPresence, own),
  });
}

/** Peers typing now; entries also expire locally so a missed event never sticks. */
export function useTyping(channelId: string) {
  const query = useQuery({
    queryKey: keys.typing(channelId),
    queryFn: async () =>
      (await api(typingSnapshotSchema, `/api/v1/channels/${channelId}/typing`)).items,
    staleTime: 0,
  });
  const [now, setNow] = useState(() => Date.now());
  const items = query.data ?? [];
  const nextExpiry = Math.min(...items.map((item) => Date.parse(item.expiresAt)));
  useEffect(() => {
    if (!Number.isFinite(nextExpiry)) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, nextExpiry - Date.now()) + 50);
    return () => clearTimeout(timer);
  }, [nextExpiry]);
  return items.filter((item) => Date.parse(item.expiresAt) > now).map((item) => item.userId);
}

const TYPING_REFRESH_MS = 5_000;
const lastTyping = new Map<string, number>();

/** Throttled "I am typing" signal; the server also clears it when the message is sent. */
export function signalTyping(channelId: string) {
  const last = lastTyping.get(channelId) ?? 0;
  if (Date.now() - last < TYPING_REFRESH_MS) return;
  lastTyping.set(channelId, Date.now());
  void apiVoid(`/api/v1/channels/${channelId}/typing`, {
    method: 'PUT',
    body: { active: true },
  }).catch(() => lastTyping.delete(channelId));
}

export function clearTypingSignal(channelId: string) {
  lastTyping.delete(channelId);
}
