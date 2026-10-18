import { defineConfig } from '@playwright/test';

/**
 * Tests against a running, seeded server (`pnpm db:seed`, or the loopback staging stack through
 * an SSH tunnel): two-client messaging and the scroll performance check. Not part of CI.
 */
export default defineConfig({
  testDir: './e2e/live',
  testMatch: '**/*.live.ts',
  timeout: 120_000,
  workers: 1,
  reporter: 'list',
});
