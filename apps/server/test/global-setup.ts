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
  const [pg, valkey] = await Promise.all([
    new PostgreSqlContainer('postgres:18.6').start(),
    new RedisContainer('valkey/valkey:9.1.2').start(),
  ]);

  const adminUrl = pg.getConnectionUri();
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
  project.provide('valkeyUrl', valkey.getConnectionUrl());

  return async () => {
    await Promise.all([pg.stop(), valkey.stop()]);
  };
}
