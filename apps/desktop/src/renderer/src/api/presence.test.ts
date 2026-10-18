import { afterEach, describe, expect, it, vi } from 'vitest';
import { watchTypingExpiry } from './presence.ts';

afterEach(() => vi.useRealTimers());
describe('typing expiry', () => {
  it('expires each peer independently and stops notifying after cleanup', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const items = [1000, 3000, 5000].map((at) => ({ expiresAt: new Date(at).toISOString() }));
    const remaining: number[] = [];
    const stop = watchTypingExpiry(items, (now) => {
      remaining.push(items.filter((item) => Date.parse(item.expiresAt) > now).length);
    });
    vi.advanceTimersByTime(3100);
    expect(remaining).toEqual([3, 2, 1]);
    stop();
    vi.advanceTimersByTime(3000);
    expect(remaining).toEqual([3, 2, 1]);
  });

  it('schedules no timer for an expired snapshot', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const changed = vi.fn();
    const stop = watchTypingExpiry([{ expiresAt: new Date(1000).toISOString() }], changed);
    expect(changed).toHaveBeenCalledWith(10_000);
    expect(vi.getTimerCount()).toBe(0);
    stop();
  });
});
