import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 30_000,
  // On CI, failures also become GitHub annotations, which are readable without repo access.
  reporter: process.env['CI'] ? [['github'], ['list']] : 'list',
  // The app holds a single-instance lock and one userData dir: run tests serially.
  workers: 1,
  fullyParallel: false,
});
