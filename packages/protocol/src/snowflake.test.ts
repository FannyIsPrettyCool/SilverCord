import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  createSnowflakeGenerator,
  SNOWFLAKE_EPOCH_MS,
  SnowflakeError,
  snowflakeFromTimestamp,
  snowflakeSchema,
  snowflakeTimestamp,
} from './snowflake.ts';

describe('snowflake generator', () => {
  it('is strictly increasing for any clock sequence, including clocks going backwards', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 10_000 }), { minLength: 1, maxLength: 500 }),
        fc.integer({ min: 0, max: 1023 }),
        (offsets, workerId) => {
          let index = 0;
          const next = createSnowflakeGenerator({
            workerId,
            now: () => SNOWFLAKE_EPOCH_MS + (offsets[index++ % offsets.length] ?? 0),
          });
          let previous = -1n;
          for (let i = 0; i < offsets.length; i++) {
            const id = next();
            expect(id).toBeGreaterThan(previous);
            previous = id;
          }
        },
      ),
    );
  });

  it('produces 10k unique ids within one millisecond', () => {
    const next = createSnowflakeGenerator({ workerId: 1, now: () => SNOWFLAKE_EPOCH_MS + 5 });
    const ids = new Set(Array.from({ length: 10_000 }, next));
    expect(ids.size).toBe(10_000);
  });

  it('round-trips its timestamp', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 41 }), (offset) => {
        const at = SNOWFLAKE_EPOCH_MS + offset;
        const id = createSnowflakeGenerator({ workerId: 3, now: () => at })();
        expect(snowflakeTimestamp(id)).toBe(at);
        expect(snowflakeFromTimestamp(at) <= id).toBe(true);
      }),
    );
  });

  it('rejects invalid worker ids and pre-epoch clocks', () => {
    expect(() => createSnowflakeGenerator({ workerId: 1024 })).toThrow(SnowflakeError);
    expect(() => createSnowflakeGenerator({ workerId: -1 })).toThrow(SnowflakeError);
    const early = createSnowflakeGenerator({ workerId: 0, now: () => SNOWFLAKE_EPOCH_MS - 1 });
    expect(early).toThrow(SnowflakeError);
  });
});

describe('snowflakeSchema', () => {
  it('accepts generated ids as strings', () => {
    const id = createSnowflakeGenerator({ workerId: 7 })();
    expect(snowflakeSchema.parse(id.toString())).toBe(id.toString());
  });

  it.each(['', '0', '-1', '01', '1.5', 'abc', '9223372036854775808', ' 1'])(
    'rejects %j',
    (value) => {
      expect(snowflakeSchema.safeParse(value).success).toBe(false);
    },
  );
});
