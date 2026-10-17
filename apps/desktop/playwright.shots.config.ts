import { defineConfig } from '@playwright/test';

/** Screenshot tour for design review; not part of test:e2e (needs a running dev server). */
export default defineConfig({
  testDir: './e2e/shots',
  testMatch: '**/*.shots.ts',
  timeout: 60_000,
  workers: 1,
  reporter: 'list',
});
