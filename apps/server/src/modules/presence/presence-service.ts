import type {
  OwnPresence,
  PresencePreference,
  PresenceSnapshot,
  PresenceStatus,
} from '@silvercord/protocol';
import { inArray, sql } from 'drizzle-orm';
import type { Database } from '../../db/client.ts';
import type { Executor } from '../../db/executor.ts';
import { channels, type EventPublisher } from '../../gateway/event-bus.ts';
import type { RelationshipsService } from '../relationships/relationships-service.ts';
import type { PresenceLeases } from './presence-leases.ts';
import { presencePreferences } from './presence-schema.ts';

/** Gateway lifecycle hooks; fire-and-forget, never throw into the socket state machine. */
export interface PresenceHooks {
  attached(userId: bigint, gatewaySessionId: string): void;
  heartbeat(userId: bigint, gatewaySessionId: string): void;
  detached(userId: bigint, gatewaySessionId: string): void;
}

export interface PresenceTimings {
  /** Disconnects wait this long before peers see offline, to avoid flapping. */
  readonly offlineDebounceMs: number;
  /** Changes per subject are coalesced into one invalidation per window. */
  readonly coalesceMs: number;
  readonly sweepMs: number;
}

export const DEFAULT_PRESENCE_TIMINGS: PresenceTimings = {
  offlineDebounceMs: 5_000,
  coalesceMs: 1_000,
  sweepMs: 5_000,
};

export interface PresenceDependencies {
  readonly db: Database;
  readonly leases: PresenceLeases;
  readonly relationships: RelationshipsService;
  readonly events: EventPublisher;
  readonly log: { warn(object: object, message: string): void };
  readonly timings?: PresenceTimings;
}

function effective(live: boolean, preference: PresencePreference): PresenceStatus {
  if (!live || preference === 'invisible') return 'offline';
  return preference;
}

/** docs/spec/presence.md */
export function createPresenceService(deps: PresenceDependencies) {
  const { db, leases, relationships, events, log } = deps;
  const timings = deps.timings ?? DEFAULT_PRESENCE_TIMINGS;
  const pendingSubjects = new Set<bigint>();
  const offlineTimers = new Map<bigint, NodeJS.Timeout>();
  let flushTimer: NodeJS.Timeout | undefined;
  let sweepTimer: NodeJS.Timeout | undefined;
  let closed = false;

  const report = (message: string) => (error: unknown) => log.warn({ err: error }, message);

  async function flush() {
    flushTimer = undefined;
    const subjects = [...pendingSubjects];
    pendingSubjects.clear();
    for (const subject of subjects) {
      const audience = new Set([subject, ...(await relationships.presenceAudience(db, subject))]);
      const userId = subject.toString();
      await Promise.all(
        [...audience].map((recipient) =>
          events.dispatch(channels.user(recipient), 'PRESENCE_CHANGED', { userId }),
        ),
      );
    }
  }

  /** Queues a content-free invalidation for everyone allowed to see `subject`. */
  function invalidate(subject: bigint) {
    if (closed) return;
    pendingSubjects.add(subject);
    flushTimer ??= setTimeout(
      () => void flush().catch(report('presence publish failed')),
      timings.coalesceMs,
    );
  }

  async function preferences(ex: Executor, userIds: readonly bigint[]) {
    if (userIds.length === 0) return new Map<bigint, PresencePreference>();
    const rows = await ex
      .select({ userId: presencePreferences.userId, status: presencePreferences.status })
      .from(presencePreferences)
      .where(inArray(presencePreferences.userId, [...userIds]));
    return new Map(rows.map((row) => [row.userId, row.status]));
  }

  const hooks: PresenceHooks = {
    attached(userId, sessionId) {
      const pending = offlineTimers.get(userId);
      if (pending) {
        clearTimeout(pending);
        offlineTimers.delete(userId);
      }
      leases
        .attach(userId, sessionId)
        // Peers never saw the debounced disconnect, so a quick reconnect publishes nothing.
        .then((wentLive) => {
          if (wentLive && !pending) invalidate(userId);
        })
        .catch(report('presence attach failed'));
    },
    heartbeat(userId, sessionId) {
      leases.refresh(userId, sessionId).catch(report('presence refresh failed'));
    },
    detached(userId, sessionId) {
      leases
        .release(userId, sessionId)
        .then((offline) => {
          if (!offline || closed || offlineTimers.has(userId)) return;
          const timer = setTimeout(() => {
            offlineTimers.delete(userId);
            leases
              .liveCount(userId)
              .then((count) => {
                if (count === 0) invalidate(userId);
              })
              .catch(report('presence debounce failed'));
          }, timings.offlineDebounceMs);
          timer.unref();
          offlineTimers.set(userId, timer);
        })
        .catch(report('presence release failed'));
    },
  };

  return {
    hooks,
    invalidate,

    /** Statuses for the requested ids only; anything not visible to the viewer reads offline. */
    async snapshot(
      ex: Executor,
      viewerId: bigint,
      userIds: readonly bigint[],
    ): Promise<PresenceSnapshot> {
      const visible = await relationships.presenceVisible(ex, viewerId, userIds);
      const visibleIds = [...visible];
      let live = new Set<bigint>();
      try {
        live = await leases.live(visibleIds);
      } catch (error) {
        // A Valkey outage degrades to a safe all-offline view; it never touches preferences.
        report('presence snapshot degraded')(error);
      }
      const saved = await preferences(ex, visibleIds);
      const observedAt = new Date().toISOString();
      return {
        items: userIds.map((userId) => ({
          userId: userId.toString(),
          status: visible.has(userId)
            ? effective(live.has(userId), saved.get(userId) ?? 'online')
            : 'offline',
          observedAt,
        })),
      };
    },

    async preference(ex: Executor, userId: bigint): Promise<OwnPresence> {
      const saved = await preferences(ex, [userId]);
      return { status: saved.get(userId) ?? 'online' };
    },

    async setPreference(
      ex: Executor,
      userId: bigint,
      status: PresencePreference,
    ): Promise<OwnPresence> {
      const [row] = await ex
        .insert(presencePreferences)
        .values({ userId, status })
        .onConflictDoUpdate({
          target: presencePreferences.userId,
          set: { status, updatedAt: sql`now()` },
        })
        .returning({ status: presencePreferences.status });
      invalidate(userId);
      return { status: row?.status ?? status };
    },

    start() {
      if (sweepTimer || closed) return;
      sweepTimer = setInterval(() => {
        leases
          .sweep()
          .then((offline) => {
            for (const userId of offline) invalidate(userId);
          })
          .catch(report('presence sweep failed'));
      }, timings.sweepMs);
      sweepTimer.unref();
    },

    async close() {
      closed = true;
      clearInterval(sweepTimer);
      for (const timer of offlineTimers.values()) clearTimeout(timer);
      offlineTimers.clear();
      if (flushTimer) {
        clearTimeout(flushTimer);
        await flush().catch(report('presence publish failed'));
      }
    },
  };
}
export type PresenceService = ReturnType<typeof createPresenceService>;
