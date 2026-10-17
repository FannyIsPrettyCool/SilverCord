import { createHash } from 'node:crypto';
import type { Valkey } from './valkey.ts';

/**
 * Token bucket stored in a Valkey hash. Runs atomically in Lua and uses the server clock, so
 * several API processes share one consistent view (BRIEF §8.1).
 *
 * KEYS[1] bucket key · ARGV capacity, refill tokens per second, cost
 * Returns { allowed (0/1), remaining tokens (floored), retry-after ms }.
 */
const TOKEN_BUCKET_LUA = `
local capacity = tonumber(ARGV[1])
local refill_per_ms = tonumber(ARGV[2]) / 1000
local cost = tonumber(ARGV[3])
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)

local state = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(state[1]) or capacity
local ts = tonumber(state[2]) or now
tokens = math.min(capacity, tokens + math.max(0, now - ts) * refill_per_ms)

local allowed = 0
local retry_after = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
else
  retry_after = math.ceil((cost - tokens) / refill_per_ms)
end

redis.call('HSET', KEYS[1], 'tokens', tokens, 'ts', now)
redis.call('PEXPIRE', KEYS[1], math.ceil(capacity / refill_per_ms) + 1000)
return { allowed, math.floor(tokens), retry_after }
`;

export interface BucketPolicy {
  /** Maximum burst. */
  readonly capacity: number;
  /** Sustained rate in tokens per second. */
  readonly refillPerSecond: number;
}

export interface ConsumeResult {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly retryAfterMs: number;
}

export interface RateLimiter {
  consume(key: string, policy: BucketPolicy, cost?: number): Promise<ConsumeResult>;
}

const SCRIPT_SHA = createHash('sha1').update(TOKEN_BUCKET_LUA).digest('hex');

function isBucketReply(value: unknown): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every((n) => typeof n === 'number');
}

/** EVALSHA with a one-time EVAL fallback when the server's script cache is cold. */
async function runBucketScript(valkey: Valkey, args: (string | number)[]): Promise<unknown> {
  try {
    return await valkey.evalsha(SCRIPT_SHA, 1, ...args);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith('NOSCRIPT')) throw error;
    return valkey.eval(TOKEN_BUCKET_LUA, 1, ...args);
  }
}

export function createRateLimiter(valkey: Valkey, prefix = 'rl:'): RateLimiter {
  return {
    async consume(key, policy, cost = 1) {
      const reply = await runBucketScript(valkey, [
        `${prefix}${key}`,
        policy.capacity,
        policy.refillPerSecond,
        cost,
      ]);
      if (!isBucketReply(reply)) throw new Error('unexpected token bucket reply');
      const [allowed, remaining, retryAfterMs] = reply;
      return { allowed: allowed === 1, remaining, retryAfterMs };
    },
  };
}
