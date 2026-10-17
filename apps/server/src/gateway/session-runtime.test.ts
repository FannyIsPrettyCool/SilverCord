import { setImmediate as immediate } from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';
import type { BusMessage } from './event-bus.ts';
import { createSessionRuntime } from './session-runtime.ts';

describe('gateway runtime kick cleanup', () => {
  it.each([false, true])('disposes after destroy (Valkey failure: %s)', async (failDestroy) => {
    let handler: ((message: BusMessage) => void) | undefined;
    const unsubscribe = vi.fn(async () => {});
    const onDisposed = vi.fn();
    const onError = vi.fn();
    const kick = vi.fn();
    const failure = new Error('Valkey unavailable');
    const destroy = vi.fn(async () => {
      if (failDestroy) throw failure;
    });
    const runtime = await createSessionRuntime(
      { id: 'session', userId: 1n, authSessionId: 2n, seq: 0 },
      {
        sessions: {
          create: vi.fn(),
          get: vi.fn(),
          append: vi.fn(),
          replay: vi.fn(),
          touch: vi.fn(),
          destroy,
        },
        subscriber: {
          async subscribe(_channel, callback) {
            handler = callback;
            return unsubscribe;
          },
          close: vi.fn(),
        },
        onDisposed,
        onError,
        initialSocket: { sendRaw: vi.fn(), kick },
      },
    );
    if (!handler) throw new Error('Missing bus subscription');
    handler({ kind: 'kick', reason: 'session_revoked' });
    await immediate();
    expect(kick).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledWith('session');
    expect(unsubscribe).toHaveBeenCalledTimes(2);
    expect(onDisposed).toHaveBeenCalledExactlyOnceWith(runtime);
    expect(runtime.isAttached()).toBe(false);
    expect(onError).toHaveBeenCalledTimes(failDestroy ? 1 : 0);
    if (failDestroy) expect(onError).toHaveBeenCalledWith(failure);
    await runtime.dispose();
    expect(onDisposed).toHaveBeenCalledOnce();
  });
});
