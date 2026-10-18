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
 * The mutation and its expiry-index update are one command. In particular, attach must not
 * yield between its live-count read and insertion: a following disconnect could otherwise
 * remove a lease that has not been inserted yet. Recompute the latest score while locked so
 * releases/sweeps cannot erase the index entry of a concurrently attached/refreshed session.
 */
const MUTATE_LEASE = `
local sessions, index = KEYS[1], KEYS[2]
local user, session, now, ttl, action = ARGV[1], ARGV[2], tonumber(ARGV[3]), tonumber(ARGV[4]), ARGV[5]
local wasLive = redis.call('ZCOUNT', sessions, '(' .. now, '+inf') > 0
if action == 'attach' then
  redis.call('ZADD', sessions, now + ttl, session)
elseif action == 'refresh' then
  if not redis.call('ZSCORE', sessions, session) then return 0 end
  redis.call('ZADD', sessions, now + ttl, session)
elseif action == 'release' then
  redis.call('ZREM', sessions, session)
end
redis.call('ZREMRANGEBYSCORE', sessions, '-inf', now)
local latest = redis.call('ZRANGE', sessions, -1, -1, 'WITHSCORES')
if #latest == 0 then
  redis.call('DEL', sessions)
  redis.call('ZREM', index, user)
else
  redis.call('PEXPIRE', sessions, ttl * 2)
  redis.call('ZADD', index, latest[2], user)
end
if action == 'attach' then return wasLive and 0 or 1 end
return #latest == 0 and 1 or 0
`;

/**
 * Valkey presence leases keyed by authenticated gateway session id. A user is live while any
 * lease is unexpired; detached (resumable) runtimes hold no lease.
 */
export function createPresenceLeases(valkey: Valkey, now: () => number = Date.now) {
  async function liveCount(userId: bigint): Promise<number> {
    return valkey.zcount(keys.sessions(userId), `(${now()}`, '+inf');
  }

  async function mutate(
    userId: bigint,
    sessionId: string,
    action: 'attach' | 'refresh' | 'release' | 'sweep',
  ) {
    const result = await valkey.eval(
      MUTATE_LEASE,
      2,
      keys.sessions(userId),
      keys.index,
      userId.toString(),
      sessionId,
      now(),
      LEASE_TTL_MS,
      action,
    );
    return Number(result) === 1;
  }

  return {
    liveCount,

    /** Returns true when this attach brought the user from no live lease to live. */
    attach: (userId: bigint, sessionId: string): Promise<boolean> =>
      mutate(userId, sessionId, 'attach'),

    /** Refreshes an existing lease only, so a revoked or detached session cannot revive one. */
    async refresh(userId: bigint, sessionId: string): Promise<void> {
      await mutate(userId, sessionId, 'refresh');
    },

    /** Returns true when no live lease remains for the user. */
    release: (userId: bigint, sessionId: string): Promise<boolean> =>
      mutate(userId, sessionId, 'release'),

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
        if (await mutate(userId, '', 'sweep')) offline.push(userId);
      }
      return offline;
    },
  };
}
export type PresenceLeases = ReturnType<typeof createPresenceLeases>;
