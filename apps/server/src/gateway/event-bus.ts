import type { DispatchEventData, DispatchEventName } from '@silvercord/protocol';
import type { Valkey } from '../infra/valkey.ts';

/** Message carried on Valkey pub/sub between producers and gateway processes. */
export type BusMessage =
  | { kind: 'dispatch'; t: DispatchEventName; d: unknown }
  | { kind: 'kick'; reason: 'session_revoked' };

export const channels = {
  user: (userId: bigint) => `gw:user:${userId}`,
  authSession: (sessionId: bigint) => `gw:auth-session:${sessionId}`,
} as const;

/** Producer side: any process can publish; it never needs to know where sockets live. */
export interface EventPublisher {
  dispatch<T extends DispatchEventName>(
    channel: string,
    t: T,
    d: DispatchEventData<T>,
  ): Promise<void>;
  kick(channel: string): Promise<void>;
}

export function createEventPublisher(valkey: Valkey): EventPublisher {
  const publish = async (channel: string, message: BusMessage) => {
    await valkey.publish(channel, JSON.stringify(message));
  };
  return {
    dispatch: (channel, t, d) => publish(channel, { kind: 'dispatch', t, d }),
    kick: (channel) => publish(channel, { kind: 'kick', reason: 'session_revoked' }),
  };
}

type Handler = (message: BusMessage) => void;

/**
 * Consumer side for a gateway process: one subscriber connection, reference-counted channel
 * subscriptions, many local handlers per channel.
 */
export interface EventSubscriber {
  subscribe(channel: string, handler: Handler): Promise<() => Promise<void>>;
  close(): Promise<void>;
}

function parse(raw: string): BusMessage | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value === 'object' && value !== null && 'kind' in value) return value as BusMessage;
  } catch {
    // Malformed bus messages are dropped; producers are internal and validated at their edge.
  }
  return null;
}

export async function createEventSubscriber(valkey: Valkey): Promise<EventSubscriber> {
  const connection = valkey.duplicate();
  if (connection.status === 'wait') await connection.connect();
  const handlers = new Map<string, Set<Handler>>();

  connection.on('message', (channel: string, raw: string) => {
    const message = parse(raw);
    if (!message) return;
    for (const handler of handlers.get(channel) ?? []) handler(message);
  });

  return {
    async subscribe(channel, handler) {
      let set = handlers.get(channel);
      if (!set) {
        set = new Set();
        handlers.set(channel, set);
        await connection.subscribe(channel);
      }
      set.add(handler);
      return async () => {
        const current = handlers.get(channel);
        if (!current) return;
        current.delete(handler);
        if (current.size === 0) {
          handlers.delete(channel);
          await connection.unsubscribe(channel);
        }
      };
    },
    async close() {
      handlers.clear();
      await connection.quit();
    },
  };
}
