import { z } from 'zod';

/**
 * 64-bit time-sortable ids (BRIEF §5.1):
 * 42 bits milliseconds since {@link SNOWFLAKE_EPOCH_MS} · 10 bits worker id · 12 bits sequence.
 * Stored as Postgres `bigint`, serialized as decimal strings on the wire.
 */
export const SNOWFLAKE_EPOCH_MS = Date.UTC(2026, 0, 1);

const WORKER_BITS = 10n;
const SEQUENCE_BITS = 12n;
const MAX_WORKER_ID = (1 << Number(WORKER_BITS)) - 1;
const MAX_SEQUENCE = (1n << SEQUENCE_BITS) - 1n;
const TIMESTAMP_SHIFT = WORKER_BITS + SEQUENCE_BITS;
const MAX_TIMESTAMP = (1n << 42n) - 1n;
const MAX_SNOWFLAKE = (1n << 63n) - 1n;

/** Wire form: decimal string of a positive signed-64-bit integer. */
const SNOWFLAKE_PATTERN = /^[1-9]\d{0,18}$/;

// Zod 4 keeps running checks after a failed regex, so the range check re-tests the pattern
// before calling BigInt (which throws on non-numeric input).
export const snowflakeSchema = z
  .string()
  .regex(SNOWFLAKE_PATTERN, 'must be a decimal snowflake id')
  .refine(
    (value) => !SNOWFLAKE_PATTERN.test(value) || BigInt(value) <= MAX_SNOWFLAKE,
    'snowflake out of range',
  );

export type Snowflake = z.infer<typeof snowflakeSchema>;

export class SnowflakeError extends Error {
  readonly code = 'SNOWFLAKE_ERROR';
}

/** Milliseconds since Unix epoch encoded in a snowflake. */
export function snowflakeTimestamp(id: bigint | string): number {
  return Number(BigInt(id) >> TIMESTAMP_SHIFT) + SNOWFLAKE_EPOCH_MS;
}

/** Smallest snowflake for a given time; useful as a `before`/`after` bound in time-based queries. */
export function snowflakeFromTimestamp(unixMs: number): bigint {
  return BigInt(Math.max(0, unixMs - SNOWFLAKE_EPOCH_MS)) << TIMESTAMP_SHIFT;
}

export interface SnowflakeGeneratorOptions {
  readonly workerId: number;
  readonly now?: () => number;
}

/**
 * Creates a monotonic generator. When the clock goes backwards the generator keeps the last
 * timestamp rather than emitting ids out of order; when a millisecond's 4096 ids are exhausted it
 * borrows the next millisecond.
 */
export function createSnowflakeGenerator(options: SnowflakeGeneratorOptions): () => bigint {
  const { workerId } = options;
  if (!Number.isInteger(workerId) || workerId < 0 || workerId > MAX_WORKER_ID) {
    throw new SnowflakeError(`workerId must be an integer in [0, ${MAX_WORKER_ID}]`);
  }
  const now = options.now ?? Date.now;
  const worker = BigInt(workerId) << SEQUENCE_BITS;
  let lastTimestamp = -1n;
  let sequence = 0n;

  return () => {
    let timestamp = BigInt(now() - SNOWFLAKE_EPOCH_MS);
    if (timestamp < 0n) throw new SnowflakeError('clock is before the snowflake epoch');
    if (timestamp <= lastTimestamp) {
      timestamp = lastTimestamp;
      sequence += 1n;
      if (sequence > MAX_SEQUENCE) {
        timestamp += 1n;
        sequence = 0n;
      }
    } else {
      sequence = 0n;
    }
    if (timestamp > MAX_TIMESTAMP) throw new SnowflakeError('snowflake timestamp overflow');
    lastTimestamp = timestamp;
    return (timestamp << TIMESTAMP_SHIFT) | worker | sequence;
  };
}
