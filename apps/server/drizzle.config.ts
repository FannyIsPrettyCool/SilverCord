import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
  casing: 'snake_case',
  dbCredentials: {
    url:
      process.env['DATABASE_URL'] ?? 'postgres://silvercord:silvercord@localhost:5432/silvercord',
  },
  strict: true,
  verbose: true,
});
