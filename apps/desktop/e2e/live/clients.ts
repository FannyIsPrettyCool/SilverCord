import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type ElectronApplication,
  _electron as electron,
  expect,
  type Page,
} from '@playwright/test';

export const API = process.env['SILVERCORD_API_URL'] ?? 'http://localhost:4000';
export const SEED_PASSWORD = 'silvercord-dev-password';

export interface Client {
  readonly app: ElectronApplication;
  readonly page: Page;
}

/** Launches an isolated Electron instance (own profile) and signs in through the real UI. */
export async function signedInClient(login: string): Promise<Client> {
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${mkdtempSync(join(tmpdir(), `silvercord-${login}-`))}`],
    cwd: join(import.meta.dirname, '../..'),
    env: { ...process.env, SILVERCORD_API_URL: API },
  });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1180, height: 860 });
  await page.goto('app://bundle/index.html?tier=low&still#/sign-in');
  await page.getByLabel(/Email or username/).fill(login);
  await page.getByLabel(/^Password/).fill(SEED_PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Connected', { timeout: 20_000 });
  return { app, page };
}

export function conversationLink(page: Page, name: string) {
  return page.getByRole('navigation', { name: 'Conversations' }).getByRole('link', { name });
}
