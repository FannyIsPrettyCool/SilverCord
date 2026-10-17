import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 30_000,
  reporter: 'list',
  // The app holds a single-instance lock and one userData dir: run tests serially.
  workers: 1,
  fullyParallel: false,
});
