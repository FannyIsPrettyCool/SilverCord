import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

/**
 * `pnpm ui:shots` (BRIEF §11.4): every phase-1 screen in each theme, captured from the real app.
 * Needs the dev stack, a running server (`pnpm dev`) and `pnpm db:seed`.
 */
const SHOTS = join(import.meta.dirname, '../../../../.artifacts/shots/app');
const THEMES = ['aurora', 'frost', 'midnight-ember'] as const;
const API = process.env['SILVERCORD_API_URL'] ?? 'http://localhost:4000';

test.beforeAll(async () => {
  const health = await fetch(`${API}/health`).catch(() => null);
  expect(
    health?.ok,
    `server not reachable at ${API}; run pnpm dev:stack, pnpm db:seed and pnpm dev`,
  ).toBe(true);
});

for (const theme of THEMES) {
  test(`screens · ${theme}`, async () => {
    const userData = mkdtempSync(join(tmpdir(), 'silvercord-shots-'));
    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userData}`],
      cwd: join(import.meta.dirname, '../..'),
    });
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1280, height: 960 });
    const base = `app://bundle/index.html?theme=${theme}&tier=high&still`;
    const shoot = async (name: string) => {
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(600);
      await page.screenshot({ path: join(SHOTS, `${name}--${theme}.png`) });
    };

    for (const [route, name] of [
      ['/sign-in', 'sign-in'],
      ['/register', 'register'],
      ['/forgot-password', 'forgot-password'],
    ] as const) {
      await page.goto(`${base}#${route}`);
      await expect(page.getByRole('heading')).toBeVisible();
      await shoot(name);
    }

    // A direct code URL must stay inaccessible without the password step.
    await page.goto(`${base}#/sign-in/code`);
    await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
    await page.getByLabel(/Email or username/).fill('mfa_preview');
    await page.getByLabel(/^Password/).fill('silvercord-dev-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Verification code' })).toBeVisible();
    await expect(page.getByLabel('6-digit code')).toBeVisible();
    await shoot('code');
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();

    await page.goto(`${base}#/sign-in`);
    await page
      .getByRole('button', { name: /Sign in/ })
      .first()
      .click();
    await expect(page.getByRole('alert').first()).toBeVisible();
    await shoot('sign-in-errors');

    await page.getByLabel(/Email or username/).fill('aurora');
    await page.getByLabel(/^Password/).fill('silvercord-dev-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Connected', { timeout: 10_000 });
    await shoot('shell');

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await app.close();
  });
}
