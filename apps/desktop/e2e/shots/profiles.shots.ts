import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, type Page, test } from '@playwright/test';

/**
 * Phase 5 profile screens from the real app: editor with crop and live preview, privacy
 * audiences, custom status, popout and full view. Needs `pnpm db:seed` accounts.
 */
const SHOTS = join(import.meta.dirname, '../../../../.artifacts/shots/app');
const THEMES = ['aurora', 'frost', 'midnight-ember'] as const;
const API = process.env['SILVERCORD_API_URL'] ?? 'http://localhost:4000';

test.beforeAll(async () => {
  const health = await fetch(`${API}/health`).catch(() => null);
  expect(health?.ok, `server not reachable at ${API}`).toBe(true);
});

/** A generated picture (no fixtures in the repo): soft radial gradients on a dark base. */
async function picture(page: Page, width: number, height: number, hue: number) {
  const data = await page.evaluate(
    ({ width, height, hue }) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('no 2d context');
      context.fillStyle = `hsl(${hue} 45% 16%)`;
      context.fillRect(0, 0, width, height);
      for (const [x, y, r, shift] of [
        [0.3, 0.35, 0.55, 0],
        [0.72, 0.6, 0.5, 70],
        [0.5, 0.9, 0.4, 150],
      ] as const) {
        const gradient = context.createRadialGradient(
          x * width,
          y * height,
          0,
          x * width,
          y * height,
          r * Math.max(width, height),
        );
        gradient.addColorStop(0, `hsl(${hue + shift} 85% 66% / 0.95)`);
        gradient.addColorStop(1, `hsl(${hue + shift} 85% 50% / 0)`);
        context.fillStyle = gradient;
        context.fillRect(0, 0, width, height);
      }
      return canvas.toDataURL('image/png').split(',')[1] ?? '';
    },
    { width, height, hue },
  );
  return Buffer.from(data, 'base64');
}

for (const theme of THEMES) {
  test(`profiles · ${theme}`, async () => {
    const userData = mkdtempSync(join(tmpdir(), 'silvercord-profile-shots-'));
    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userData}`],
      cwd: join(import.meta.dirname, '../..'),
    });
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1360, height: 960 });
    const shoot = async (name: string) => {
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(800);
      await page.screenshot({ path: join(SHOTS, `${name}--${theme}.png`) });
    };

    await page.goto(`app://bundle/index.html?theme=${theme}&tier=high&still#/sign-in`);
    await page.getByLabel(/Email or username/).fill('aurora');
    await page.getByLabel(/^Password/).fill('silvercord-dev-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Friends', exact: true })).toBeVisible({
      timeout: 15_000,
    });

    // Editor: reached from the user panel menu.
    await page.getByRole('button', { name: 'Status', exact: true }).click();
    await page.getByRole('button', { name: 'Edit profile' }).click();
    await expect(page.getByRole('heading', { name: 'Profile', exact: true })).toBeVisible();
    await page.getByLabel('Display name').fill('Aurora');
    await page.getByLabel('Pronouns').fill('she/they');
    await page
      .getByLabel('About me')
      .fill('Night-shift **shader** tinkerer.\nCollects ||aurora|| photos and `ogl` snippets.');

    const avatarInput = page.locator('input[type="file"][aria-label="Avatar"]');
    await avatarInput.setInputFiles({
      name: 'avatar.png',
      mimeType: 'image/png',
      buffer: await picture(page, 640, 480, 200),
    });
    await expect(page.getByRole('heading', { name: 'Crop image' })).toBeVisible();
    await shoot('profile-crop');
    await page.getByRole('button', { name: 'Apply' }).click();
    const bannerInput = page.locator('input[type="file"][aria-label="Banner"]');
    await expect(page.getByRole('status').filter({ hasText: /Uploading|Processing/ })).toHaveCount(
      0,
      { timeout: 20_000 },
    );
    await bannerInput.setInputFiles({
      name: 'banner.png',
      mimeType: 'image/png',
      buffer: await picture(page, 1500, 700, 260),
    });
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByRole('status').filter({ hasText: /Uploading|Processing/ })).toHaveCount(
      0,
      { timeout: 20_000 },
    );
    const primary = page.getByRole('group', { name: 'Profile theme' }).getByRole('checkbox');
    if (await primary.nth(1).isChecked()) await primary.nth(1).uncheck();
    await shoot('profile-editor');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 10_000 });

    await page.getByRole('link', { name: 'Profile privacy' }).click();
    await expect(page.getByLabel('Mutual servers')).toBeVisible();
    await shoot('profile-privacy');
    await page.getByRole('link', { name: 'Server profiles' }).click();
    await shoot('profile-servers');
    const badgesLink = page.getByRole('link', { name: 'Badges', exact: true });
    if (await badgesLink.isVisible()) {
      await badgesLink.click();
      await expect(page.getByRole('heading', { name: 'Create badge' })).toBeVisible();
      // Let the badge list load before deciding whether the tour badge exists.
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(800);
      if ((await page.getByText('Night owl', { exact: true }).count()) === 0) {
        await page.getByLabel('Name', { exact: true }).fill('Night owl');
        await page.getByLabel('Description', { exact: true }).fill('Ships after midnight');
        await page.getByRole('radio', { name: 'moon' }).check();
        await page.getByRole('button', { name: 'Create badge' }).click();
        await expect(page.getByText('Night owl', { exact: true }).first()).toBeVisible();
        await page.getByLabel('Username').first().fill('tide');
        await page.getByRole('button', { name: 'Award', exact: true }).first().click();
        await page.getByLabel('Username').first().fill('aurora');
        await page.getByRole('button', { name: 'Award', exact: true }).first().click();
      }
      await shoot('settings-badges');
    }
    await page.getByRole('button', { name: 'Close settings' }).click();

    // Custom status from the user panel.
    await page.getByRole('button', { name: 'Status', exact: true }).click();
    await page.getByRole('button', { name: /custom status/ }).click();
    await page.getByLabel('Emoji').fill('🌙');
    await page.getByRole('textbox', { name: 'Status' }).fill('Shipping profiles');
    await shoot('custom-status');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('heading', { name: /custom status/ })).toHaveCount(0);
    await expect(page.getByText('Shipping profiles').first()).toBeVisible();

    // Activity: typed plus a Local RPC program the user approves.
    await page.getByRole('button', { name: 'Status', exact: true }).click();
    await page.getByRole('button', { name: 'Edit profile' }).click();
    await page.getByRole('link', { name: 'Activity', exact: true }).click();
    for (const source of ['Typed activity', 'Local RPC']) {
      const box = page.getByRole('checkbox', { name: source });
      if ((await box.getAttribute('aria-checked')) !== 'true') await box.click();
      await expect(box).toHaveAttribute('aria-checked', 'true');
    }
    await page.getByLabel('Name', { exact: true }).fill('Profile polish');
    await page.getByLabel('Details', { exact: true }).fill('Phase 5');
    await page.getByRole('button', { name: 'Set activity' }).click();
    await expect(page.getByRole('button', { name: 'Clear activity' })).toBeVisible();
    await shoot('settings-activity');
    let rpc: ChildProcess | undefined;
    try {
      rpc = spawn(
        process.execPath,
        [join(import.meta.dirname, '../../../../tools/rpc-example.mjs'), 'Tour', 'Tetrominoes'],
        { stdio: 'ignore' },
      );
      const allow = page.getByRole('button', { name: 'Allow', exact: true });
      if (await allow.isVisible({ timeout: 15_000 }).catch(() => false)) {
        await shoot('rpc-request');
        await allow.click();
      }
      await page.waitForTimeout(6_000);
      await page.getByRole('button', { name: 'Close settings' }).click();

      // Popout and full view from a conversation.
      await page
        .getByRole('navigation', { name: 'Conversations' })
        .getByRole('link', { name: 'Tide' })
        .click();
      await expect(page.getByRole('article').last()).toBeVisible({ timeout: 15_000 });
      await page.getByRole('button', { name: 'Aurora' }).first().click();
      await expect(page.getByRole('dialog').getByRole('heading', { name: 'Aurora' })).toBeVisible();
      await shoot('profile-popout-self');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('article', { name: 'Aurora', exact: true })).toHaveCount(0);
      await page.locator('header').getByRole('button', { name: 'Tide' }).first().click();
      await expect(page.getByRole('button', { name: 'View full profile' })).toBeVisible();
      await shoot('profile-popout');
      await page.getByRole('button', { name: 'View full profile' }).click();
      await shoot('profile-full');
      await page.keyboard.press('Escape');
    } finally {
      rpc?.kill();
    }
    await page.getByRole('button', { name: 'Sign out' }).click();
    await app.close();
  });
}
