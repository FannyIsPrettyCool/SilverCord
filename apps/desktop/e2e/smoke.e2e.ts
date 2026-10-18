import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

const shotsDir = join(import.meta.dirname, '../../../.artifacts/shots');

test('opens a hardened empty window', async () => {
  const app = await electron.launch({ args: ['.'], cwd: join(import.meta.dirname, '..') });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  // The window stays hidden until `ready-to-show`; screenshots of hidden windows hang.
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false),
    )
    .toBe(true);

  await expect(page).toHaveTitle('SilverCord');
  await expect(page.getByRole('heading', { name: /Sign in|Connexion/ })).toBeVisible();

  // Renderer must not see Node; only the typed bridge is exposed.
  const exposure = await page.evaluate(() => ({
    hasRequire: typeof (globalThis as { require?: unknown }).require !== 'undefined',
    hasProcess: typeof (globalThis as { process?: unknown }).process !== 'undefined',
    bridgeKeys: Object.keys((globalThis as unknown as { desktop: object }).desktop),
  }));
  expect(exposure).toEqual({
    hasRequire: false,
    hasProcess: false,
    bridgeKeys: ['config', 'auth', 'window', 'media', 'activity'],
  });
  expect(page.url()).toBe('app://bundle/index.html#/sign-in');

  const prefs = await app.evaluate(({ BrowserWindow }) => {
    const [win] = BrowserWindow.getAllWindows();
    // Undocumented but stable accessor; it reflects the prefs actually applied.
    const contents = win?.webContents as unknown as { getLastWebPreferences(): unknown };
    return contents.getLastWebPreferences();
  });
  expect(prefs).toMatchObject({
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
  });

  mkdirSync(shotsDir, { recursive: true });
  await page.screenshot({ path: join(shotsDir, 'phase0-empty-window.png') });
  await app.close();
});

test('auth panels stay centered and registration scrolls in a short window', async () => {
  const app = await electron.launch({ args: ['.'], cwd: join(import.meta.dirname, '..') });
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.getByRole('heading', { name: /Sign in|Connexion/ })).toBeVisible();
    const panel = await page.locator('form').boundingBox();
    expect(panel).not.toBeNull();
    if (!panel) throw new Error('auth panel missing');
    expect(Math.abs(panel.x + panel.width / 2 - 640)).toBeLessThan(2);

    await page.setViewportSize({ width: 940, height: 560 });
    await page.goto('app://bundle/index.html#/register');
    const title = page.getByRole('heading', { name: /Create account|Créer un compte/ });
    await expect(title).toBeVisible();
    const heading = await title.boundingBox();
    expect(heading?.y).toBeGreaterThanOrEqual(40);
    const submit = page.getByRole('button', {
      name: /Create account|Créer le compte/,
      exact: true,
    });
    await submit.scrollIntoViewIfNeeded();
    await expect(submit).toBeInViewport();
    const headingAfterScroll = await title.boundingBox();
    expect(headingAfterScroll?.y).toBeLessThan(heading?.y ?? 0);
  } finally {
    await app.close();
  }
});
