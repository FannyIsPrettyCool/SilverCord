import { dispatchEventSchemas } from '@silvercord/protocol';
import {
  forgetChatCacheMetadata,
  reconcileNewest,
  refreshMessage,
  resetMessageHistories,
} from './chat.ts';
import { profileChanged } from './profiles.ts';
import { keys, queryClient } from './query-client.ts';

const SEEN_LIMIT = 500;
const seen = new Set<string>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** Collapses bursts of invalidations (e.g. presence) into one refetch. */
function debounced(key: string, ms: number, task: () => void) {
  clearTimeout(timers.get(key));
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      task();
    }, ms),
  );
}

/** Duplicate durable events are expected (ADR-0008); the first one wins. */
function firstSighting(eventId: string): boolean {
  if (seen.has(eventId)) return false;
  seen.add(eventId);
  if (seen.size > SEEN_LIMIT) {
    const [oldest] = seen;
    if (oldest) seen.delete(oldest);
  }
  return true;
}

const invalidate = (queryKey: readonly unknown[]) =>
  void queryClient.invalidateQueries({ queryKey: [...queryKey] });

/** Maps content-free gateway invalidations onto the REST cache. */
export function handleDispatch(t: string, d: unknown) {
  if (t === 'GUILD_CHANGED' || t === 'GUILD_MEMBERS_CHANGED') {
    const event = dispatchEventSchemas[t].safeParse(d);
    if (!event.success || !firstSighting(event.data.eventId)) return;
    void resetMessageHistories();
    invalidate(keys.guild(event.data.guildId));
    invalidate(keys.guildChannels(event.data.guildId));
    invalidate(keys.guildExpressions(event.data.guildId));
    debounced('expressions', 300, () => invalidate(keys.usableExpressions));
    debounced('guilds', 200, () => invalidate(keys.guilds));
    return;
  }
  if (t === 'RELATIONSHIPS_CHANGED') {
    const event = dispatchEventSchemas.RELATIONSHIPS_CHANGED.safeParse(d);
    if (!event.success || !firstSighting(event.data.eventId)) return;
    invalidate(keys.relationships());
    invalidate(keys.privacy);
    void resetMessageHistories();
    debounced('presence', 300, () => invalidate(keys.presence()));
    debounced('channels', 200, () => invalidate(keys.channels));
    return;
  }
  if (t === 'CHANNEL_CHANGED') {
    const event = dispatchEventSchemas.CHANNEL_CHANGED.safeParse(d);
    if (!event.success || !firstSighting(event.data.eventId)) return;
    invalidate(keys.channel(event.data.channelId));
    debounced('channels', 200, () => invalidate(keys.channels));
    return;
  }
  if (t === 'MESSAGE_CHANGED') {
    const event = dispatchEventSchemas.MESSAGE_CHANGED.safeParse(d);
    if (!event.success || !firstSighting(event.data.eventId)) return;
    const { channelId, messageId } = event.data;
    if (queryClient.getQueryData(keys.messages(channelId)))
      void refreshMessage(channelId, messageId).catch(() => undefined);
    debounced('channels', 200, () => invalidate(keys.channels));
    debounced('guild-read-state', 200, () => invalidate(keys.guildChannels()));
    return;
  }
  if (t === 'READ_STATE_CHANGED') {
    const event = dispatchEventSchemas.READ_STATE_CHANGED.safeParse(d);
    if (!event.success || !firstSighting(event.data.eventId)) return;
    invalidate(keys.channel(event.data.channelId));
    debounced('guild-read-state', 200, () => invalidate(keys.guildChannels()));
    debounced('channels', 200, () => invalidate(keys.channels));
    return;
  }
  if (t === 'PRESENCE_CHANGED') {
    debounced('presence', 300, () => invalidate(keys.presence()));
    if (dispatchEventSchemas.PRESENCE_CHANGED.safeParse(d).success) invalidate(keys.ownPresence);
    return;
  }
  if (t === 'PROFILE_CHANGED') {
    const event = dispatchEventSchemas.PROFILE_CHANGED.safeParse(d);
    if (event.success) profileChanged(event.data.userId);
    return;
  }
  if (t === 'TYPING_CHANGED') {
    const event = dispatchEventSchemas.TYPING_CHANGED.safeParse(d);
    if (event.success) invalidate(keys.typing(event.data.channelId));
  }
}

/**
 * Pub/sub delivery is at-most-once, so READY, RESUMED, focus and a 30 s timer re-read the
 * authorized state (ADR-0008).
 */
export function reconcile(resetHistory = false) {
  invalidate(keys.relationships());
  invalidate(keys.channels);
  invalidate(keys.guilds);
  invalidate(['guild']);
  invalidate(keys.guildChannels());
  invalidate(keys.usableExpressions);
  invalidate(keys.presence());
  invalidate(['summary']);
  invalidate(['profile']);
  invalidate(keys.ownProfile);
  for (const query of queryClient.getQueryCache().findAll({ queryKey: ['messages'] })) {
    const channelId = query.queryKey[1];
    if (typeof channelId === 'string' && query.getObserversCount() > 0)
      void reconcileNewest(channelId, resetHistory).catch(() => undefined);
  }
}

export function resetSync() {
  forgetChatCacheMetadata();
  seen.clear();
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
}
