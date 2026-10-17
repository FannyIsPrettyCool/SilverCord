import { describe, expect, it } from 'vitest';
import { healthResponseSchema } from './health.ts';

describe('healthResponseSchema', () => {
  it('accepts a valid payload', () => {
    const payload = { status: 'ok', service: 'api', version: '0.0.0', uptimeSeconds: 1.5 };
    expect(healthResponseSchema.parse(payload)).toEqual(payload);
  });

  it('rejects negative uptime and unknown status', () => {
    expect(
      healthResponseSchema.safeParse({
        status: 'ok',
        service: 'api',
        version: '0',
        uptimeSeconds: -1,
      }).success,
    ).toBe(false);
    expect(
      healthResponseSchema.safeParse({
        status: 'down',
        service: 'api',
        version: '0',
        uptimeSeconds: 0,
      }).success,
    ).toBe(false);
  });
});
