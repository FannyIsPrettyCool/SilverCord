import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase } from '../../test/database.ts';
import type { DatabaseHandle } from './client.ts';

describe('migrations', () => {
  let handle: DatabaseHandle;
  beforeAll(async () => {
    handle = await createTestDatabase();
  });
  afterAll(() => handle.close());

  it('installs required extensions', async () => {
    const rows = await handle.db.execute<{ extname: string }>(
      sql`select extname from pg_extension where extname in ('pg_trgm', 'citext') order by extname`,
    );
    expect(rows.map((row) => row.extname)).toEqual(['citext', 'pg_trgm']);
  });

  it('returns bigint columns as bigint', async () => {
    const [row] = await handle.db.execute<{ value: bigint }>(
      sql`select 9007199254740993::bigint as value`,
    );
    expect(row?.value).toBe(9007199254740993n);
  });
});
