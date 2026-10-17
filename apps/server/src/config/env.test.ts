import { describe, expect, it } from 'vitest';
import { InvalidConfigError, loadEnv } from './env.ts';

describe('loadEnv', () => {
  it('applies defaults', () => {
    expect(loadEnv({})).toMatchObject({ NODE_ENV: 'development', PORT: 4000 });
  });

  it('refuses invalid values', () => {
    expect(() => loadEnv({ PORT: '99999' })).toThrow(InvalidConfigError);
    expect(() => loadEnv({ NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });
});
