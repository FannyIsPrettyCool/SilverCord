import { loadEnv } from '../config/env.ts';
import { createDatabase } from './client.ts';
import { runMigrations } from './migrate.ts';

const env = loadEnv();
const handle = createDatabase(env.DATABASE_URL, { max: 1 });
try {
  await runMigrations(handle.db);
  process.stdout.write('migrations applied\n');
} finally {
  await handle.close();
}
