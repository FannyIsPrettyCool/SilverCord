import { randomBytes } from 'node:crypto';
import type { Valkey } from '../infra/valkey.ts';

/** How long a disconnected session can be resumed, and how far back events are replayable. */
export const RESUME_WINDOW_MS = 5 * 60 * 1000;
const MAX_BUFFERED_EVENTS = 1000;

export interface GatewaySession {
  readonly id: string;
  readonly userId: bigint;
  readonly authSessionId: bigint;
  readonly seq: number;
}

export interface BufferedEvent {
  readonly seq: number;
  readonly frame: string;
}

const keys = {
  session: (id: string) => `gw:session:${id}`,
  events: (id: string) => `gw:session:${id}:events`,
};

/** Gateway session state in Valkey so a resume can land on any gateway process. */
export function createSessionStore(valkey: Valkey) {
  const ttlMs = RESUME_WINDOW_MS;

  return {
    async create(userId: bigint, authSessionId: bigint): Promise<GatewaySession> {
      const id = randomBytes(16).toString('base64url');
      await valkey
        .multi()
        .hset(keys.session(id), {
          userId: userId.toString(),
          authSessionId: authSessionId.toString(),
          seq: '0',
        })
        .pexpire(keys.session(id), ttlMs)
        .exec();
      return { id, userId, authSessionId, seq: 0 };
    },

    async get(id: string): Promise<GatewaySession | null> {
      const hash = await valkey.hgetall(keys.session(id));
      const { userId, authSessionId, seq } = hash;
      if (userId === undefined || authSessionId === undefined || seq === undefined) return null;
      return { id, userId: BigInt(userId), authSessionId: BigInt(authSessionId), seq: Number(seq) };
    },

    /**
     * Assigns the next sequence number and buffers the serialized frame. `build` receives the
     * sequence so the frame embeds it.
     */
    async append(id: string, build: (seq: number) => string): Promise<string> {
      const seq = await valkey.hincrby(keys.session(id), 'seq', 1);
      const frame = build(seq);
      const minId = Math.max(0, Date.now() - RESUME_WINDOW_MS);
      await valkey
        .multi()
        .xadd(
          keys.events(id),
          'MAXLEN',
          '~',
          MAX_BUFFERED_EVENTS,
          '*',
          's',
          String(seq),
          'f',
          frame,
        )
        .xtrim(keys.events(id), 'MINID', '~', minId)
        .pexpire(keys.events(id), ttlMs)
        .pexpire(keys.session(id), ttlMs)
        .exec();
      return frame;
    },

    /** Events after `afterSeq`, or null when some of them have already been trimmed. */
    async replay(
      id: string,
      afterSeq: number,
      currentSeq: number,
    ): Promise<BufferedEvent[] | null> {
      const entries = await valkey.xrange(keys.events(id), '-', '+');
      const events: BufferedEvent[] = [];
      for (const [, fields] of entries) {
        const seq = Number(fields[fields.indexOf('s') + 1]);
        const frame = fields[fields.indexOf('f') + 1];
        if (seq > afterSeq && frame !== undefined) events.push({ seq, frame });
      }
      const expected = currentSeq - afterSeq;
      if (afterSeq > currentSeq || events.length !== expected) return null;
      return events;
    },

    /** Keeps state alive while connected; called on every heartbeat. */
    async touch(id: string): Promise<void> {
      await valkey.multi().pexpire(keys.session(id), ttlMs).pexpire(keys.events(id), ttlMs).exec();
    },

    async destroy(id: string): Promise<void> {
      await valkey.del(keys.session(id), keys.events(id));
    },
  };
}

export type SessionStore = ReturnType<typeof createSessionStore>;
