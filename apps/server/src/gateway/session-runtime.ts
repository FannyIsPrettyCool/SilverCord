import { type DispatchEventName, GatewayOp } from '@silvercord/protocol';
import { type BusMessage, channels, type EventSubscriber } from './event-bus.ts';
import { type GatewaySession, RESUME_WINDOW_MS, type SessionStore } from './session-store.ts';

export interface AttachedSocket {
  sendRaw(frame: string): void;
  kick(): void;
}

/**
 * Event pipeline of one gateway session. It outlives its socket for the resume window, keeps
 * buffering into the session stream while detached, and is adopted by the socket that resumes.
 * Every append runs on one serial queue, so sequence numbers and delivery order always agree.
 */
export interface SessionRuntime {
  readonly session: GatewaySession;
  /** Runs `task` after everything already queued for this session. */
  run<T>(task: () => Promise<T>): Promise<T>;
  dispatch(t: DispatchEventName, d: unknown): Promise<void>;
  attach(socket: AttachedSocket): void;
  detach(socket: AttachedSocket): void;
  dispose(): Promise<void>;
}

export interface RuntimeDependencies {
  readonly sessions: SessionStore;
  readonly subscriber: EventSubscriber;
  readonly onError: (error: unknown) => void;
  /** Called once when the runtime ends (expiry, kick or explicit dispose). */
  readonly onDisposed: (runtime: SessionRuntime) => void;
}

export async function createSessionRuntime(
  session: GatewaySession,
  deps: RuntimeDependencies,
): Promise<SessionRuntime> {
  let queue: Promise<unknown> = Promise.resolve();
  let attached: AttachedSocket | null = null;
  let expiry: NodeJS.Timeout | undefined;
  let disposed = false;
  const unsubscribers: (() => Promise<void>)[] = [];

  const run = <T>(task: () => Promise<T>): Promise<T> => {
    const result = queue.then(task);
    queue = result.catch(deps.onError);
    return result;
  };

  async function dispatch(t: DispatchEventName, d: unknown) {
    const frame = await deps.sessions.append(session.id, (s) =>
      JSON.stringify({ op: GatewayOp.DISPATCH, t, s, d }),
    );
    attached?.sendRaw(frame);
  }

  const runtime: SessionRuntime = {
    session,
    run,
    dispatch: (t, d) => run(() => dispatch(t, d)),
    attach(socket) {
      clearTimeout(expiry);
      attached = socket;
    },
    detach(socket) {
      if (attached !== socket) return;
      attached = null;
      expiry = setTimeout(() => void runtime.dispose(), RESUME_WINDOW_MS);
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      clearTimeout(expiry);
      attached = null;
      await Promise.all(unsubscribers.splice(0).map((unsubscribe) => unsubscribe()));
      deps.onDisposed(runtime);
    },
  };

  function onMessage(message: BusMessage) {
    if (message.kind === 'kick') {
      attached?.kick();
      void run(() => deps.sessions.destroy(session.id)).then(() => runtime.dispose());
      return;
    }
    void run(() => dispatch(message.t, message.d));
  }

  for (const channel of [
    channels.user(session.userId),
    channels.authSession(session.authSessionId),
  ]) {
    unsubscribers.push(await deps.subscriber.subscribe(channel, onMessage));
  }
  return runtime;
}
