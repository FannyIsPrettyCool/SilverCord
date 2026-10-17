import { defineConfig } from '@playwright/test';

/** Visual snapshots of every story in each theme and glass tier (BRIEF §10.2). */
export default defineConfig({
  testDir: './visual',
  testMatch: '**/*.visual.ts',
  timeout: 30_000,
  workers: 1,
  reporter: process.env['CI'] ? [['github'], ['list']] : 'list',
  snapshotPathTemplate: '{testDir}/__snapshots__/{arg}{ext}',
  expect: { toHaveScreenshot: { animations: 'disabled', caret: 'hide' } },
});
