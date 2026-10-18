import {
  type DurableEventData,
  type DurableEventName,
  durableEventSchemas,
} from '@silvercord/protocol';
import { and, asc, eq, isNull, lte, sql } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import type { Executor } from '../db/executor.ts';
import { channels, type EventPublisher } from '../gateway/event-bus.ts';
import { eventOutbox } from './outbox-schema.ts';

export type DurablePayload<T extends DurableEventName> = Omit<DurableEventData<T>, 'eventId'>;

export interface EventOutbox {
  /**
   * Queues one invalidation per distinct recipient inside the caller's transaction, so it is
   * published if and only if the domain change commits.
   */
  enqueue<T extends DurableEventName>(
    ex: Executor,
    type: T,
    recipients: readonly bigint[],
    payload: DurablePayload<T>,
  ): Promise<void>;
}

export function createEventOutbox(nextId: () => bigint): EventOutbox {
  return {
    async enqueue(ex, type, recipients, payload) {
      const rows = [...new Set(recipients)].map((recipientUserId) => {
        const id = nextId();
        const data = durableEventSchemas[type].parse({ ...payload, eventId: id.toString() });
        return { id, recipientUserId, type, payload: data };
      });
      if (rows.length) await ex.insert(eventOutbox).values(rows);
    },
  };
}

export interface OutboxDispatcherDependencies {
  readonly db: Database;
  readonly events: EventPublisher;
  readonly log: { warn(object: object, message: string): void };
}

const BATCH_SIZE = 100;
const TICK_MS = 250;
const MAINTENANCE_MS = 60_000;
const ALERT_AGE_MS = 60_000;

/** One dispatcher per API process (ADR-0008). PUBLISH may be duplicated; REST reconciles gaps. */
export function createOutboxDispatcher({ db, events, log }: OutboxDispatcherDependencies) {
  let active: Promise<void> | null = null;
  let timer: NodeJS.Timeout | undefined;
  let lastMaintenance = 0;

  async function publish(row: typeof eventOutbox.$inferSelect) {
    const type = row.type;
    const payload = durableEventSchemas[type].parse(row.payload);
    await events.dispatch(channels.user(row.recipientUserId), type, payload);
    await db.update(eventOutbox).set({ publishedAt: sql`now()` }).where(eq(eventOutbox.id, row.id));
  }

  async function dispatch() {
    const rows = await db
      .select()
      .from(eventOutbox)
      .where(and(isNull(eventOutbox.publishedAt), lte(eventOutbox.availableAt, sql`now()`)))
      .orderBy(asc(eventOutbox.availableAt), asc(eventOutbox.id))
      .limit(BATCH_SIZE);
    for (const row of rows) {
      try {
        await publish(row);
      } catch {
        const delay = Math.min(60_000, TICK_MS * 2 ** Math.min(row.attempts, 8));
        await db
          .update(eventOutbox)
          .set({
            attempts: row.attempts + 1,
            // Database clock throughout, so app/DB clock skew cannot strand or rush a row.
            availableAt: sql`now() + make_interval(secs => ${delay / 1000})`,
          })
          .where(eq(eventOutbox.id, row.id));
        log.warn(
          { eventId: row.id.toString(), pendingAgeMs: Date.now() - row.createdAt.getTime() },
          'event publication deferred',
        );
      }
    }
    if (Date.now() - lastMaintenance >= MAINTENANCE_MS) {
      lastMaintenance = Date.now();
      await db
        .delete(eventOutbox)
        .where(sql`${eventOutbox.publishedAt} < now() - interval '24 hours'`);
      const [oldest] = await db
        .select({ createdAt: eventOutbox.createdAt })
        .from(eventOutbox)
        .where(isNull(eventOutbox.publishedAt))
        .orderBy(asc(eventOutbox.createdAt))
        .limit(1);
      if (oldest && Date.now() - oldest.createdAt.getTime() > ALERT_AGE_MS)
        log.warn({ pendingAgeMs: Date.now() - oldest.createdAt.getTime() }, 'event outbox delayed');
    }
  }

  function tick(): Promise<void> {
    active ??= dispatch()
      .catch(() => log.warn({}, 'event outbox dispatch failed'))
      .finally(() => {
        active = null;
      });
    return active;
  }

  return {
    tick,
    start() {
      if (timer) return;
      void tick();
      timer = setInterval(() => void tick(), TICK_MS);
      timer.unref();
    },
    async close() {
      clearInterval(timer);
      timer = undefined;
      await active;
    },
  };
}
export type OutboxDispatcher = ReturnType<typeof createOutboxDispatcher>;
