import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { inject } from 'vitest';
import { createDatabase, type DatabaseHandle } from '../src/db/client.ts';

/** Creates an isolated, migrated database cloned from the template. Call once per test file. */
export async function createTestDatabase(): Promise<DatabaseHandle & { url: string }> {
  const adminUrl = inject('postgresAdminUrl');
  const name = `test_${randomBytes(6).toString('hex')}`;
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${name} TEMPLATE ${inject('templateDatabase')}`);
  await admin.end();

  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const handle = createDatabase(url.toString(), { max: 4 });
  return { ...handle, url: url.toString() };
}
