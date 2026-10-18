import { TYPING_TTL_MS, type TypingSnapshot } from '@silvercord/protocol';
import type { Database } from '../../db/client.ts';
import { channels as buses, type EventPublisher } from '../../gateway/event-bus.ts';
import { AppError } from '../../http/app-error.ts';
import type { Valkey } from '../../infra/valkey.ts';
import type { ChannelsService } from '../channels/channels-service.ts';
import type { RelationshipsService } from '../relationships/relationships-service.ts';

/** A still-fresh marker is not rewritten (or re-announced) more than once per window. */
const REFRESH_AFTER_MS = 4_000;
const COALESCE_MS = 1_000;
const MAX_TYPING_PEERS = 9;

const keys = {
  /** ZSET `<userId>:<authSessionId>` → marker expiry (ms). */
  channel: (channelId: bigint) => `typing:channel:${channelId}`,
  /** SET of channel ids the auth session typed in, for disconnect cleanup. */
  session: (authSessionId: bigint) => `typing:session:${authSessionId}`,
};

export interface TypingDependencies {
  readonly db: Database;
  readonly valkey: Valkey;
  readonly channels: ChannelsService;
  readonly relationships: RelationshipsService;
  readonly events: EventPublisher;
  readonly log: { warn(object: object, message: string): void };
  readonly now?: () => number;
}

/**
 * Typing markers (docs/spec/presence.md): no text, length or keystrokes are stored. Author and
 * session always come from the authenticated request.
 */
export function createTypingService(deps: TypingDependencies) {
  const { db, valkey, channels, relationships, events, log } = deps;
  const now = deps.now ?? Date.now;
  const pendingChannels = new Set<bigint>();
  let flushTimer: NodeJS.Timeout | undefined;

  async function flush() {
    flushTimer = undefined;
    const ids = [...pendingChannels];
    pendingChannels.clear();
    for (const channelId of ids) {
      const members = await channels.memberIds(db, channelId);
      const payload = { channelId: channelId.toString() };
      await Promise.all(
        members.map((member) => events.dispatch(buses.user(member), 'TYPING_CHANGED', payload)),
      );
    }
  }

  function announce(channelId: bigint) {
    pendingChannels.add(channelId);
    flushTimer ??= setTimeout(
      () =>
        void flush().catch((error: unknown) => log.warn({ err: error }, 'typing publish failed')),
      COALESCE_MS,
    );
  }

  async function typingUsers(channelId: bigint): Promise<Map<bigint, number>> {
    const key = keys.channel(channelId);
    await valkey.zremrangebyscore(key, '-inf', now());
    const entries = await valkey.zrange(key, '0', '-1', 'WITHSCORES');
    const users = new Map<bigint, number>();
    for (let index = 0; index + 1 < entries.length; index += 2) {
      const member = entries[index] ?? '';
      const userId = BigInt(member.split(':')[0] ?? '0');
      const expiry = Number(entries[index + 1]);
      users.set(userId, Math.max(users.get(userId) ?? 0, expiry));
    }
    return users;
  }

  async function clearMarker(channelId: bigint, userId: bigint, authSessionId: bigint) {
    const removed = await valkey.zrem(keys.channel(channelId), `${userId}:${authSessionId}`);
    if (removed > 0 && !(await typingUsers(channelId)).has(userId)) announce(channelId);
  }

  return {
    async set(userId: bigint, authSessionId: bigint, channelId: bigint, active: boolean) {
      await channels.requireMember(db, channelId, userId);
      if (!active) return clearMarker(channelId, userId, authSessionId);
      if (!(await channels.canInteract(db, channelId, userId)))
        throw new AppError('FORBIDDEN', 'You cannot type in this conversation');
      const key = keys.channel(channelId);
      const member = `${userId}:${authSessionId}`;
      const current = await valkey.zscore(key, member);
      if (current !== null && Number(current) - now() > TYPING_TTL_MS - REFRESH_AFTER_MS) return;
      const wasTyping = (await typingUsers(channelId)).has(userId);
      await valkey
        .multi()
        .zadd(key, now() + TYPING_TTL_MS, member)
        .pexpire(key, TYPING_TTL_MS * 2)
        .sadd(keys.session(authSessionId), channelId.toString())
        .pexpire(keys.session(authSessionId), TYPING_TTL_MS * 2)
        .exec();
      if (!wasTyping) announce(channelId);
    },

    /** Called after a successful send from that session. */
    clear: clearMarker,

    /** Gateway disconnect: drop every marker this auth session still holds. */
    async clearSession(userId: bigint, authSessionId: bigint) {
      const channelIds = await valkey.smembers(keys.session(authSessionId));
      await valkey.del(keys.session(authSessionId));
      for (const raw of channelIds) await clearMarker(BigInt(raw), userId, authSessionId);
    },

    /** Leaving a channel removes the user's markers there at once. */
    async clearUser(channelId: bigint, userId: bigint) {
      const key = keys.channel(channelId);
      const members = await valkey.zrange(key, '0', '-1');
      const mine = members.filter((member) => member.startsWith(`${userId}:`));
      if (mine.length === 0) return;
      await valkey.zrem(key, ...mine);
      announce(channelId);
    },

    async snapshot(viewerId: bigint, channelId: bigint): Promise<TypingSnapshot> {
      await channels.requireMember(db, channelId, viewerId);
      const users = await typingUsers(channelId);
      users.delete(viewerId);
      const blocked = await relationships.blockedEitherWay(db, viewerId, [...users.keys()]);
      const items = [...users]
        .filter(([userId]) => !blocked.has(userId))
        .sort((a, b) => a[1] - b[1])
        .slice(0, MAX_TYPING_PEERS)
        .map(([userId, expiry]) => ({
          userId: userId.toString(),
          expiresAt: new Date(expiry).toISOString(),
        }));
      return { items };
    },

    async close() {
      if (flushTimer) {
        clearTimeout(flushTimer);
        await flush().catch((error: unknown) => log.warn({ err: error }, 'typing publish failed'));
      }
    },
  };
}
export type TypingService = ReturnType<typeof createTypingService>;
