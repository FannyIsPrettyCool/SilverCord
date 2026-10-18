import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { conversationLink, signedInClient } from './clients.ts';

/**
 * docs/PERF.md: loads the whole 10k-message seed (SEED_PERF_MESSAGES=10000) into the virtual
 * list, then scrolls it end to end while timing every animation frame.
 */
const OUT = join(import.meta.dirname, '../../../../.artifacts/perf');

test('10k-message history scrolls within the frame budget', async () => {
  test.setTimeout(600_000);
  const { app, page } = await signedInClient('aurora');
  try {
    await conversationLink(page, 'MFA preview').click();
    const log = page.getByRole('log', { name: 'Message history' });
    await expect(log.getByRole('article').last()).toBeVisible({ timeout: 20_000 });

    // Pull every page by holding the scroll at the top until nothing older loads.
    const loaded = await page.evaluate(async () => {
      const element = document.querySelector<HTMLElement>('[role="log"]');
      if (!element) throw new Error('no log');
      let stable = 0;
      let height = element.scrollHeight;
      while (stable < 12) {
        element.scrollTop = 0;
        await new Promise((resolve) => setTimeout(resolve, 250));
        if (element.scrollHeight === height) stable += 1;
        else {
          stable = 0;
          height = element.scrollHeight;
        }
      }
      return element.scrollHeight;
    });

    const result = await page.evaluate(async () => {
      const element = document.querySelector<HTMLElement>('[role="log"]');
      if (!element) throw new Error('no log');
      element.scrollTop = 0;
      await new Promise((resolve) => setTimeout(resolve, 500));
      const deltas: number[] = [];
      const step = 360;
      let last = performance.now();
      await new Promise<void>((resolve) => {
        const frame = (now: number) => {
          deltas.push(now - last);
          last = now;
          const before = element.scrollTop;
          element.scrollTop = before + step;
          if (element.scrollTop === before) resolve();
          else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      });
      const sorted = [...deltas.slice(1)].sort((a, b) => a - b);
      const at = (p: number) =>
        sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
      return {
        frames: sorted.length,
        renderedArticles: element.querySelectorAll('article').length,
        p50: at(0.5),
        p95: at(0.95),
        p99: at(0.99),
        over17: sorted.filter((value) => value > 17.5).length / sorted.length,
        over33: sorted.filter((value) => value > 33.4).length / sorted.length,
      };
    });
    const summary = { date: new Date().toISOString(), scrollHeight: loaded, ...result };
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, 'scroll.json'), `${JSON.stringify(summary, null, 2)}\n`);
    console.log(JSON.stringify(summary));
    expect(result.p95).toBeLessThan(20);
  } finally {
    await app.close();
  }
});
