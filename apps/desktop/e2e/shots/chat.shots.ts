import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

/**
 * Phase 2 screens from the real app: friends, a DM in each density, mention autocomplete,
 * message actions and the group dialog. Needs a server with `pnpm db:seed` data.
 */
const SHOTS = join(import.meta.dirname, '../../../../.artifacts/shots/app');
const THEMES = ['aurora', 'frost', 'midnight-ember'] as const;
const API = process.env['SILVERCORD_API_URL'] ?? 'http://localhost:4000';

test.beforeAll(async () => {
  const health = await fetch(`${API}/health`).catch(() => null);
  expect(health?.ok, `server not reachable at ${API}`).toBe(true);
});

for (const theme of THEMES) {
  test(`chat · ${theme}`, async () => {
    const userData = mkdtempSync(join(tmpdir(), 'silvercord-chat-shots-'));
    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userData}`],
      cwd: join(import.meta.dirname, '../..'),
    });
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1280, height: 960 });
    const shoot = async (name: string) => {
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(700);
      await page.screenshot({ path: join(SHOTS, `${name}--${theme}.png`) });
    };

    await page.goto(`app://bundle/index.html?theme=${theme}&tier=high&still#/sign-in`);
    await page.getByLabel(/Email or username/).fill('aurora');
    await page.getByLabel(/^Password/).fill('silvercord-dev-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Friends', exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole('tab', { name: /All/ }).click();
    await expect(page.getByText('@tide')).toBeVisible();
    await shoot('friends');

    await page
      .getByRole('navigation', { name: 'Conversations' })
      .getByRole('link', { name: 'Tide' })
      .click();
    await expect(page.getByRole('log', { name: 'Message history' })).toBeVisible();
    await expect(page.getByRole('article').last()).toBeVisible({ timeout: 15_000 });
    await shoot('dm-cozy');

    for (const density of ['Compact', 'Bubble'] as const) {
      await page.getByText(density, { exact: true }).click();
      await shoot(`dm-${density.toLowerCase()}`);
    }
    await page.getByText('Cozy', { exact: true }).click();

    const composer = page.getByRole('textbox', { name: 'Message Tide' });
    await composer.click();
    await composer.pressSequentially('Hello @ti');
    await expect(page.getByRole('option', { name: /Tide/ })).toBeVisible();
    await shoot('composer-mention');
    await page.keyboard.press('Enter');
    await composer.pressSequentially(' **shipped** from the tour');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('article').last()).toContainText('shipped');

    await page.getByRole('article').last().hover();
    await expect(page.getByRole('button', { name: 'Add reaction' }).last()).toBeVisible();
    await shoot('message-actions');

    await page.getByRole('button', { name: 'New group' }).click();
    await expect(page.getByRole('heading', { name: 'New group' })).toBeVisible();
    await shoot('new-group');
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await app.close();
  });
}
