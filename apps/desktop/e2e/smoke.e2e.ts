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
    bridgeKeys: ['config', 'auth', 'window'],
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
