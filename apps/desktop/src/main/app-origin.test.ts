import { describe, expect, it } from 'vitest';
import { isRendererOrigin, isRendererUrl } from './app-origin.ts';

describe('renderer origin checks', () => {
  it('matches app://bundle URLs by scheme and host, not by the opaque "null" origin', () => {
    expect(new URL('app://bundle/index.html').origin).toBe('null');
    expect(isRendererUrl('app://bundle/index.html#/sign-in')).toBe(true);
    expect(isRendererUrl('app://evil/index.html')).toBe(false);
    expect(isRendererUrl('other://bundle/')).toBe(false);
    expect(isRendererUrl('https://bundle/')).toBe(false);
    expect(isRendererUrl('not a url')).toBe(false);
  });

  it('never treats an opaque origin as the renderer', () => {
    expect(isRendererOrigin('null')).toBe(false);
    expect(isRendererOrigin('app://bundle')).toBe(true);
  });
});
