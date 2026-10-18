import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const app = vi.hoisted(() => ({ isPackaged: true, getVersion: () => '0.2.0' }));
vi.mock('electron', () => ({ app }));
const { loadConfig } = await import('./config.ts');

beforeEach(() => {
  app.isPackaged = true;
  vi.stubEnv('SILVERCORD_API_URL', undefined);
  vi.stubEnv('SILVERCORD_MEDIA_URL', undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('instance endpoints', () => {
  it('uses the separate private media origin for the owner production instance', () => {
    expect(loadConfig()).toMatchObject({
      apiUrl: 'https://silvercord.islandmon.cloud',
      mediaUrl: 'https://cdn.silvercord.islandmon.cloud',
      gatewayUrl: 'wss://silvercord.islandmon.cloud/gateway/v1',
    });
    app.isPackaged = false;
    vi.stubEnv('SILVERCORD_API_URL', 'https://silvercord.islandmon.cloud/');
    expect(loadConfig().mediaUrl).toBe('https://cdn.silvercord.islandmon.cloud');
  });

  it('keeps local and self-hosted media on their API unless explicitly configured', () => {
    app.isPackaged = false;
    expect(loadConfig()).toMatchObject({
      apiUrl: 'http://localhost:4000',
      mediaUrl: 'http://localhost:4000',
    });
    vi.stubEnv('SILVERCORD_API_URL', 'https://chat.example.test');
    expect(loadConfig().mediaUrl).toBe('https://chat.example.test');
    vi.stubEnv('SILVERCORD_MEDIA_URL', 'https://files.example.test/');
    expect(loadConfig().mediaUrl).toBe('https://files.example.test');
  });

  it.each(['http://localhost:4001', 'http://127.0.0.2:4001', 'http://[::1]:4001'])(
    'allows an explicit loopback media endpoint: %s',
    (url) => {
      vi.stubEnv('SILVERCORD_MEDIA_URL', url);
      expect(loadConfig().mediaUrl).toBe(url);
    },
  );

  it.each([
    'http://files.example.test',
    'http://localhost.example.test',
    'http://127.0.0.1.example.test',
    'ftp://localhost',
    'file:///tmp/media',
    'https://user:password@files.example.test',
  ])('rejects unsafe media endpoint: %s', (url) => {
    vi.stubEnv('SILVERCORD_MEDIA_URL', url);
    expect(loadConfig).toThrow('SILVERCORD_MEDIA_URL');
  });
});
