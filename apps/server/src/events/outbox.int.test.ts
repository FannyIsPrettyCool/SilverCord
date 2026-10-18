import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestDatabase } from '../../test/database.ts';
import type { DatabaseHandle } from '../db/client.ts';
import type { EventPublisher } from '../gateway/event-bus.ts';
import { createEventOutbox, createOutboxDispatcher } from './outbox.ts';

describe('transactional invalidation outbox', () => {
  let handle: DatabaseHandle;
  let nextId = 10n;
  beforeAll(async () => {
    handle = await createTestDatabase();
    await handle.db.execute(
      sql`insert into users (id,username,email,password_hash,locale,age_confirmed_at) values (1,'outbox_user','outbox@example.test','not-used','en',now())`,
    );
  });
  afterAll(() => handle.close());
  const enqueue = () => createEventOutbox(() => nextId++);
  const count = async () =>
    (
      await handle.db.execute<{ total: number }>(
        sql`select count(*)::int as total from event_outbox`,
      )
    )[0]?.total;

  it('rolls invalidation back with its domain transaction', async () => {
    await expect(
      handle.db.transaction(async (tx) => {
        await enqueue().enqueue(tx, 'RELATIONSHIPS_CHANGED', [1n], {});
        throw new Error('rolled back');
      }),
    ).rejects.toThrow('rolled back');
    expect(await count()).toBe(0);
  });

  it('recovers pending events on dispatcher restart with bounded, content-free retry', async () => {
    await enqueue().enqueue(handle.db, 'RELATIONSHIPS_CHANGED', [1n, 1n], {});
    expect(await count()).toBe(1);
    const dispatch = vi.fn(async () => {
      throw new Error('publish unavailable');
    });
    const events: EventPublisher = { dispatch, kick: vi.fn(async () => {}) };
    const log = { warn: vi.fn() };
    const first = createOutboxDispatcher({ db: handle.db, events, log });
    await first.tick();
    await first.close();
    const [failed] = await handle.db.execute<{
      attempts: number;
      published_at: string | null;
      payload: object;
    }>(sql`select attempts,published_at,payload from event_outbox`);
    expect(failed).toMatchObject({ attempts: 1, published_at: null });
    expect(Object.keys(failed?.payload ?? {})).toEqual(['eventId']);
    await handle.db.execute(sql`update event_outbox set available_at = now()`);
    const delivered = vi.fn(async () => {});
    const restarted = createOutboxDispatcher({
      db: handle.db,
      events: { dispatch: delivered, kick: events.kick },
      log,
    });
    await restarted.tick();
    await restarted.close();
    expect(delivered).toHaveBeenCalledWith('gw:user:1', 'RELATIONSHIPS_CHANGED', { eventId: '11' });
    const [published] = await handle.db.execute<{ published: boolean }>(
      sql`select published_at is not null as published from event_outbox`,
    );
    expect(published?.published).toBe(true);
  });

  it('purges published rows after 24 hours while retaining pending rows and alerting on queue age', async () => {
    await handle.db.execute(
      sql`update event_outbox set published_at = now() - interval '25 hours'`,
    );
    await enqueue().enqueue(handle.db, 'RELATIONSHIPS_CHANGED', [1n], {});
    await handle.db.execute(
      sql`update event_outbox set created_at = now() - interval '2 days' where published_at is null`,
    );
    const log = { warn: vi.fn() };
    const dispatcher = createOutboxDispatcher({
      db: handle.db,
      events: {
        dispatch: vi.fn(async () => {
          throw new Error('down');
        }),
        kick: vi.fn(async () => {}),
      },
      log,
    });
    await dispatcher.tick();
    await dispatcher.close();
    expect(await count()).toBe(1);
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ pendingAgeMs: expect.any(Number) }),
      'event outbox delayed',
    );
  });
});
