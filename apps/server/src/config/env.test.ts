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

  it('refuses development secrets in production', () => {
    expect(() => loadEnv({ NODE_ENV: 'production' })).toThrow(/JWT_SECRET/);
    const production = {
      NODE_ENV: 'production',
      JWT_SECRET: 'x'.repeat(48),
      TOTP_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
    };
    expect(loadEnv(production).NODE_ENV).toBe('production');
  });

  it('validates key length', () => {
    expect(() => loadEnv({ TOTP_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') })).toThrow(
      /32 bytes/,
    );
  });
});
