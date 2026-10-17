import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type ElectronApplication,
  _electron as electron,
  expect,
  type Page,
  test,
} from '@playwright/test';
import { serveStatic } from './static-server.ts';

const STORYBOOK = join(import.meta.dirname, '../storybook-static');
const SHOTS = join(import.meta.dirname, '../../../.artifacts/shots/storybook');
const THEMES = ['aurora', 'frost', 'midnight-ember'];
const TIERS = ['high', 'low', 'solid'];

const index = JSON.parse(readFileSync(join(STORYBOOK, 'index.json'), 'utf8')) as {
  entries: Record<string, { id: string; type: string }>;
};
const stories = Object.values(index.entries)
  .filter((entry) => entry.type === 'story')
  .map((entry) => entry.id);

let app: ElectronApplication;
let page: Page;
let baseUrl: string;
let close: () => void;

test.beforeAll(async () => {
  const served = await serveStatic(STORYBOOK);
  baseUrl = served.url;
  close = () => served.server.close();
  app = await electron.launch({ args: [join(import.meta.dirname, 'electron-host.cjs')] });
  page = await app.firstWindow();
});
test.afterAll(async () => {
  await app.close();
  close();
});

for (const story of stories) {
  for (const theme of THEMES) {
    for (const tier of TIERS) {
      test(`${story} · ${theme} · ${tier}`, async () => {
        await page.goto(
          `${baseUrl}/iframe.html?id=${story}&viewMode=story&globals=theme:${theme};tier:${tier}`,
        );
        await page.waitForSelector('#storybook-root > *');
        await page.evaluate(() => document.fonts.ready);
        // Lets late-arriving CSS finish its colour transitions before the capture.
        await page.waitForTimeout(700);
        const name = `${story}--${theme}--${tier}.png`;
        // Full frames for human review; baselines crop to the story to keep the repo small.
        await page.screenshot({ path: join(SHOTS, name) });
        const subject = page.locator('[data-story-subject]');
        await expect(subject).toHaveScreenshot(name, { maxDiffPixelRatio: 0.02, scale: 'css' });
      });
    }
  }
}
