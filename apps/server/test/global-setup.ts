import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';
import postgres from 'postgres';
import type { TestProject } from 'vitest/node';
import { createDatabase } from '../src/db/client.ts';
import { runMigrations } from '../src/db/migrate.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    postgresAdminUrl: string;
    templateDatabase: string;
    valkeyUrl: string;
  }
}

const TEMPLATE_DATABASE = 'silvercord_template';

/**
 * Starts real Postgres and Valkey once per run (same images as compose), migrates a template
 * database, and lets each test file clone it for isolation.
 */
export default async function setup(project: TestProject) {
  const services = await startServices();
  const adminUrl = services.postgresAdminUrl;
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${TEMPLATE_DATABASE}`);
  await admin.end();

  const templateUrl = new URL(adminUrl);
  templateUrl.pathname = `/${TEMPLATE_DATABASE}`;
  const template = createDatabase(templateUrl.toString(), { max: 1 });
  await runMigrations(template.db);
  await template.close();

  project.provide('postgresAdminUrl', adminUrl);
  project.provide('templateDatabase', TEMPLATE_DATABASE);
  project.provide('valkeyUrl', services.valkeyUrl);
  return services.stop;
}

/**
 * Testcontainers by default. Hosts without a local Docker daemon point the suite at fresh,
 * throwaway services instead (`tools/scripts/remote-integration.sh`).
 */
async function startServices() {
  const postgresAdminUrl = process.env['TEST_POSTGRES_ADMIN_URL'];
  const valkeyUrl = process.env['TEST_VALKEY_URL'];
  if (postgresAdminUrl && valkeyUrl) {
    return { postgresAdminUrl, valkeyUrl, stop: async () => {} };
  }
  const [pg, valkey] = await Promise.all([
    new PostgreSqlContainer('postgres:18.6').start(),
    new RedisContainer('valkey/valkey:9.1.2').start(),
  ]);
  return {
    postgresAdminUrl: pg.getConnectionUri(),
    valkeyUrl: valkey.getConnectionUrl(),
    stop: async () => {
      await Promise.all([pg.stop(), valkey.stop()]);
    },
  };
}
