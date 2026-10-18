import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dialog } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DesktopConfig } from '../shared/ipc-contract.ts';
import type { AuthAgent } from './auth/auth-agent.ts';

vi.mock('electron', () => ({ dialog: { showSaveDialog: vi.fn() } }));
const { downloadMedia, MEDIA_PATH_PATTERN, safeFilename } = await import('./media-download.ts');

const directories: string[] = [];
const config: DesktopConfig = {
  apiUrl: 'https://api.example.test',
  mediaUrl: 'https://files.example.test',
  gatewayUrl: 'wss://api.example.test/gateway/v1',
  platform: 'linux',
  version: '0.2.0',
};
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('media downloads', () => {
  it('accepts only authorized media variant paths', () => {
    const hash = 'a'.repeat(64);
    expect(MEDIA_PATH_PATTERN.test(`/media/123/download/${hash}`)).toBe(true);
    for (const path of [
      `/media/123/download/${hash}/../../etc`,
      `https://evil.example/media/1/download/${hash}`,
      `/api/v1/auth/sessions`,
      `/media/123/original/${hash}`,
    ])
      expect(MEDIA_PATH_PATTERN.test(path), path).toBe(false);
  });

  it('turns hostile names into a plain default filename', () => {
    expect(safeFilename('..\\..\\Windows\\system32\\evil.dll')).toBe('evil.dll');
    expect(safeFilename('../../.bashrc')).toBe('_bashrc');
    expect(safeFilename('a:b*c?.txt')).toBe('a_b_c_.txt');
    expect(safeFilename('‮gnp.exe')).toBe('_gnp.exe');
    expect(safeFilename('')).toBe('download');
  });

  it('downloads through the trusted media origin with fresh auth and no redirects', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'media-download-'));
    directories.push(directory);
    const filePath = join(directory, 'image.jpg');
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath });
    const fetch = vi.fn().mockResolvedValue(new Response('private-media'));
    vi.stubGlobal('fetch', fetch);
    const auth = {
      accessToken: vi.fn().mockResolvedValue({ accessToken: 'fresh-token' }),
    } as unknown as AuthAgent;
    const path = `/media/123/download/${'a'.repeat(64)}`;
    expect(await downloadMedia({ config, auth, window: null }, path, 'image.jpg')).toBe(true);
    expect(fetch).toHaveBeenCalledWith(new URL(path, config.mediaUrl), {
      headers: { authorization: 'Bearer fresh-token' },
      redirect: 'error',
    });
    expect((await readFile(filePath)).toString()).toBe('private-media');
  });

  it('refuses foreign media URLs before opening a dialog or requesting tokens', async () => {
    const auth = { accessToken: vi.fn() } as unknown as AuthAgent;
    expect(
      await downloadMedia(
        { config, auth, window: null },
        `https://evil.example/media/123/download/${'a'.repeat(64)}`,
        'image.jpg',
      ),
    ).toBe(false);
    expect(dialog.showSaveDialog).not.toHaveBeenCalled();
    expect(auth.accessToken).not.toHaveBeenCalled();
  });
});
