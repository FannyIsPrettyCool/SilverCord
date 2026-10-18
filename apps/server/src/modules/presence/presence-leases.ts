import type { Valkey } from '../../infra/valkey.ts';

/** Lease lifetime; refreshed by each acknowledged gateway heartbeat (~41 s). */
export const LEASE_TTL_MS = 100_000;
const SWEEP_BATCH = 100;

const keys = {
  /** ZSET gateway session id → lease expiry (ms). */
  sessions: (userId: bigint) => `presence:sessions:${userId}`,
  /** ZSET user id → latest lease expiry; bounded sweep input, never a keyspace scan. */
  index: 'presence:index',
};

/**
 * Valkey presence leases keyed by authenticated gateway session id. A user is live while any
 * lease is unexpired; detached (resumable) runtimes hold no lease.
 */
export function createPresenceLeases(valkey: Valkey, now: () => number = Date.now) {
  async function liveCount(userId: bigint): Promise<number> {
    return valkey.zcount(keys.sessions(userId), `(${now()}`, '+inf');
  }

  return {
    liveCount,

    /** Returns true when this attach brought the user from no live lease to live. */
    async attach(userId: bigint, sessionId: string): Promise<boolean> {
      const wasLive = (await liveCount(userId)) > 0;
      const expiry = now() + LEASE_TTL_MS;
      await valkey
        .multi()
        .zadd(keys.sessions(userId), expiry, sessionId)
        .pexpire(keys.sessions(userId), LEASE_TTL_MS * 2)
        .zadd(keys.index, 'GT', expiry, userId.toString())
        .exec();
      return !wasLive;
    },

    /** Refreshes an existing lease only, so a revoked or detached session cannot revive one. */
    async refresh(userId: bigint, sessionId: string): Promise<void> {
      const expiry = now() + LEASE_TTL_MS;
      const updated = await valkey.zadd(keys.sessions(userId), 'XX', 'CH', expiry, sessionId);
      if (Number(updated) === 0) return;
      await valkey
        .multi()
        .pexpire(keys.sessions(userId), LEASE_TTL_MS * 2)
        .zadd(keys.index, 'GT', expiry, userId.toString())
        .exec();
    },

    /** Returns true when no live lease remains for the user. */
    async release(userId: bigint, sessionId: string): Promise<boolean> {
      await valkey.zrem(keys.sessions(userId), sessionId);
      const offline = (await liveCount(userId)) === 0;
      if (offline) await valkey.zrem(keys.index, userId.toString());
      return offline;
    },

    async live(userIds: readonly bigint[]): Promise<Set<bigint>> {
      if (userIds.length === 0) return new Set();
      const pipeline = valkey.pipeline();
      for (const userId of userIds) pipeline.zcount(keys.sessions(userId), `(${now()}`, '+inf');
      const results = (await pipeline.exec()) ?? [];
      const live = new Set<bigint>();
      results.forEach(([error, count], index) => {
        const userId = userIds[index];
        if (!error && Number(count) > 0 && userId !== undefined) live.add(userId);
      });
      return live;
    },

    /**
     * Drops expired leases of up to one batch of users (crashed processes never release).
     * Returns the users that went offline.
     */
    async sweep(): Promise<bigint[]> {
      const due = await valkey.zrangebyscore(keys.index, '-inf', now(), 'LIMIT', 0, SWEEP_BATCH);
      const offline: bigint[] = [];
      for (const raw of due) {
        const userId = BigInt(raw);
        await valkey.zremrangebyscore(keys.sessions(userId), '-inf', now());
        const [, latest] = await valkey.zrange(keys.sessions(userId), '-1', '-1', 'WITHSCORES');
        if (latest === undefined) {
          await valkey.zrem(keys.index, raw);
          offline.push(userId);
        } else {
          await valkey.zadd(keys.index, Number(latest), raw);
        }
      }
      return offline;
    },
  };
}
export type PresenceLeases = ReturnType<typeof createPresenceLeases>;
