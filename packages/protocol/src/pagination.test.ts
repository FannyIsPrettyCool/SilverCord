import { describe, expect, it } from 'vitest';
import { errorEnvelopeSchema } from './errors.ts';
import { cursorPageQuerySchema, PAGE_LIMIT_DEFAULT } from './pagination.ts';

describe('cursorPageQuerySchema', () => {
  it('defaults and coerces the limit', () => {
    expect(cursorPageQuerySchema.parse({})).toEqual({ limit: PAGE_LIMIT_DEFAULT });
    expect(cursorPageQuerySchema.parse({ limit: '10', before: '123' })).toEqual({
      limit: 10,
      before: '123',
    });
  });

  it('rejects both bounds and out-of-range limits', () => {
    expect(cursorPageQuerySchema.safeParse({ before: '1', after: '2' }).success).toBe(false);
    expect(cursorPageQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(cursorPageQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
  });
});

describe('errorEnvelopeSchema', () => {
  it('rejects unknown codes', () => {
    expect(errorEnvelopeSchema.safeParse({ error: { code: 'NOPE', message: 'x' } }).success).toBe(
      false,
    );
    expect(
      errorEnvelopeSchema.safeParse({
        error: { code: 'RATE_LIMITED', message: 'x', retryAfterSeconds: 3 },
      }).success,
    ).toBe(true);
  });
});
