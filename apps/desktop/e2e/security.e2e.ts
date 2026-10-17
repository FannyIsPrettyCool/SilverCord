import { join } from 'node:path';
import {
  type ElectronApplication,
  _electron as electron,
  expect,
  type Page,
  test,
} from '@playwright/test';

/** BRIEF §8.2 checklist, asserted against the real built app. */
let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  app = await electron.launch({ args: ['.'], cwd: join(import.meta.dirname, '..') });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
});
test.afterAll(() => app.close());

test('web preferences are locked down', async () => {
  const prefs = await app.evaluate(({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0]?.webContents as unknown as {
      getLastWebPreferences(): unknown;
    };
    return contents.getLastWebPreferences();
  });
  expect(prefs).toMatchObject({
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    experimentalFeatures: false,
  });
});

test('renderer is served from the custom protocol with a strict CSP', async () => {
  expect(page.url()).toMatch(/^app:\/\/bundle\/index\.html/);
  const csp = await page.evaluate(async () =>
    (await fetch('/index.html')).headers.get('content-security-policy'),
  );
  expect(csp).toContain("default-src 'none'");
  expect(csp).toContain("script-src 'self';");
  // CDP-evaluated code is exempt from the page CSP, so eval is asserted through the header and
  // inline execution through a real violation event.
  expect(csp).not.toContain('unsafe-eval');
  expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
  const inlineBlocked = await page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        document.addEventListener('securitypolicyviolation', () => resolve(true), { once: true });
        const script = document.createElement('script');
        script.textContent = 'window.__inline = 1';
        document.body.append(script);
        setTimeout(() => resolve(false), 500);
      }),
  );
  expect(inlineBlocked, 'inline script').toBe(true);
});

test('bundle paths cannot escape the renderer directory', async () => {
  // Unknown paths fall back to index.html, so success means "did not read package.json".
  for (const path of [
    '%2e%2e/%2e%2e/package.json',
    '..%2f..%2fpackage.json',
    '..%5c..%5cpackage.json',
  ]) {
    const leaked = await page.evaluate(async (target) => {
      const response = await fetch(`app://bundle/${target}`);
      return (await response.text()).includes('"@silvercord/desktop"');
    }, path);
    expect(leaked, path).toBe(false);
  }
});

test('popups are denied; only https links go to the OS browser', async () => {
  // Stub the OS hand-off so the test has no side effects (CI's xdg-open would hang teardown).
  await app.evaluate(({ shell }) => {
    const calls: string[] = [];
    (globalThis as { openedExternally?: string[] }).openedExternally = calls;
    shell.openExternal = async (url: string) => {
      calls.push(url);
    };
  });
  const opened = await page.evaluate(() =>
    [
      'https://example.com/a',
      'http://example.com/b',
      'file:///etc/passwd',
      'javascript:alert(1)',
    ].map((url) => window.open(url) !== null),
  );
  expect(opened).toEqual([false, false, false, false]);
  expect(app.windows()).toHaveLength(1);
  const external = await app.evaluate(
    () => (globalThis as { openedExternally?: string[] }).openedExternally,
  );
  expect(external).toEqual(['https://example.com/a']);
});

test('foreign navigation is blocked', async () => {
  await page.evaluate(() => {
    window.location.href = 'https://example.com';
  });
  await page.waitForTimeout(300);
  expect(page.url()).toMatch(/^app:\/\/bundle\/index\.html/);
});

test('permissions outside the allow-list are denied', async () => {
  const states = await page.evaluate(async () => {
    const query = async (name: string) => {
      try {
        return (await navigator.permissions.query({ name: name as PermissionName })).state;
      } catch {
        return 'error';
      }
    };
    return { geolocation: await query('geolocation'), midi: await query('midi') };
  });
  expect(states.geolocation).toBe('denied');
  expect(['denied', 'error']).toContain(states.midi);
});

test('ipc rejects invalid input', async () => {
  const result = await page.evaluate(() =>
    (
      window as unknown as { desktop: { auth: { login(i: unknown): Promise<unknown> } } }
    ).desktop.auth.login({ login: '' }),
  );
  expect(result).toEqual({
    ok: false,
    error: { code: 'VALIDATION_FAILED', message: 'Invalid input' },
  });
});
