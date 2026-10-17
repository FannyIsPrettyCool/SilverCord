import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startFrameSampling } from './frame-sampler.ts';

describe('governor sampling bursts', () => {
  let frames: Map<number, FrameRequestCallback>;
  let now: number;
  let focused: boolean;

  beforeEach(() => {
    vi.useFakeTimers();
    frames = new Map();
    now = 0;
    focused = true;
    let nextFrame = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal(
      'document',
      Object.assign(new EventTarget(), { hidden: false, hasFocus: () => focused }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const nextFrame = (elapsed = 16) => {
    const pending = [...frames.values()];
    frames.clear();
    now += elapsed;
    for (const callback of pending) callback(now);
  };

  it('leaves no RAF running between bursts and does not sample the idle gap', () => {
    const sample = vi.fn();
    const stop = startFrameSampling(sample, { frames: 3, intervalMs: 5000 });
    for (let i = 0; i < 4; i++) nextFrame();
    expect(sample.mock.calls).toEqual([[16], [16], [16]]);
    expect(frames.size).toBe(0);
    vi.advanceTimersByTime(4999);
    expect(frames.size).toBe(0);
    vi.advanceTimersByTime(1);
    expect(frames.size).toBe(1);
    nextFrame(5000);
    nextFrame();
    expect(sample.mock.calls).toEqual([[16], [16], [16], [16]]);
    stop();
    expect(frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels RAFs and timers while unfocused and resumes without recording the gap', () => {
    const sample = vi.fn();
    const stop = startFrameSampling(sample, { frames: 2, intervalMs: 5000 });
    nextFrame();
    focused = false;
    window.dispatchEvent(new Event('blur'));
    expect(frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    focused = true;
    window.dispatchEvent(new Event('focus'));
    nextFrame(7000);
    nextFrame();
    nextFrame();
    expect(sample.mock.calls).toEqual([[16], [16]]);
    expect(vi.getTimerCount()).toBe(1);
    focused = false;
    window.dispatchEvent(new Event('blur'));
    vi.advanceTimersByTime(5000);
    expect(frames.size).toBe(0);
    stop();
    focused = true;
    window.dispatchEvent(new Event('focus'));
    expect(frames.size).toBe(0);
  });

  it('does not start when hidden and pauses an active burst when hidden', () => {
    const sample = vi.fn();
    Object.assign(document, { hidden: true });
    const stop = startFrameSampling(sample, { frames: 2, intervalMs: 5000 });
    expect(frames.size).toBe(0);
    Object.assign(document, { hidden: false });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(frames.size).toBe(1);
    Object.assign(document, { hidden: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(frames.size).toBe(0);
    stop();
  });
});
