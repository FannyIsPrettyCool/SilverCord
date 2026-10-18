import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ dialog: {} }));
const { MEDIA_PATH_PATTERN, safeFilename } = await import('./media-download.ts');

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
});
