import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, type Page } from '@playwright/test';
import { API, SEED_PASSWORD } from './clients.ts';

/** One real Electron process per host; capture event names only, never credentials/payloads. */
export async function machineClient(login: 'aurora' | 'tide') {
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'silvercord-machine-'))}`],
    cwd: join(import.meta.dirname, '../..'),
    env: { ...process.env, SILVERCORD_API_URL: API },
  });
  try {
    const page = await app.firstWindow();
    const events: string[] = [];
    page.on('websocket', (socket) =>
      socket.on('framereceived', ({ payload }) => {
        try {
          const frame: unknown = JSON.parse(String(payload));
          if (
            typeof frame === 'object' &&
            frame !== null &&
            't' in frame &&
            typeof frame.t === 'string'
          )
            events.push(frame.t);
        } catch {
          /* A non-JSON frame is irrelevant to acceptance evidence. */
        }
      }),
    );
    await page.setViewportSize({ width: 1180, height: 860 });
    await page.goto('app://bundle/index.html?tier=low&still#/sign-in');
    await page.getByLabel(/Email or username/).fill(login);
    await page.getByLabel(/^Password/).fill(SEED_PASSWORD);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Connected', { timeout: 20_000 });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.focus());
    return { app, page, events };
  } catch (error) {
    await app.close();
    throw error;
  }
}

/** Painted bounds include descendants while honoring clipping and invisible controls. */
export function transcriptGeometry(page: Page) {
  return page.getByRole('article').evaluateAll((articles) =>
    articles.flatMap((article) => {
      const box = article.getBoundingClientRect();
      const viewport = article.closest('[role="log"]')?.getBoundingClientRect();
      const viewportTop = viewport?.top ?? 0;
      const viewportBottom = viewport?.bottom ?? window.innerHeight;
      let top = Number.POSITIVE_INFINITY;
      let bottom = Number.NEGATIVE_INFINITY;
      const include = (paintTop: number, paintBottom: number) => {
        paintTop = Math.max(paintTop, viewportTop);
        paintBottom = Math.min(paintBottom, viewportBottom);
        if (paintTop >= paintBottom) return;
        top = Math.min(top, paintTop);
        bottom = Math.max(bottom, paintBottom);
      };
      include(box.top, box.bottom);
      for (const child of article.children) {
        // The hover toolbar deliberately floats over the message above; it is not transcript flow.
        if (['absolute', 'fixed'].includes(getComputedStyle(child).position)) continue;
        for (const descendant of [child, ...child.querySelectorAll('*')]) {
          const rect = descendant.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;
          let paintTop = rect.top;
          let paintBottom = rect.bottom;
          let visible = true;
          for (
            let ancestor: Element | null = descendant;
            ancestor;
            ancestor = ancestor.parentElement
          ) {
            const style = getComputedStyle(ancestor);
            if (
              Number(style.opacity) === 0 ||
              style.visibility === 'hidden' ||
              style.display === 'none'
            ) {
              visible = false;
              break;
            }
            if (
              ancestor !== descendant &&
              ['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowY)
            ) {
              const clip = ancestor.getBoundingClientRect();
              paintTop = Math.max(paintTop, clip.top);
              paintBottom = Math.min(paintBottom, clip.bottom);
            }
            if (ancestor === article) break;
          }
          if (visible) include(paintTop, paintBottom);
        }
      }
      if (!Number.isFinite(top) || !Number.isFinite(bottom)) return [];
      const row = article.parentElement;
      return [
        {
          id: article.getAttribute('data-message-id'),
          text: article.textContent?.slice(0, 180),
          top,
          bottom,
          articleTop: box.top,
          articleBottom: box.bottom,
          rowTop: row?.getBoundingClientRect().top,
          rowHeight: row?.getBoundingClientRect().height,
          rowOffsetHeight: row instanceof HTMLElement ? row.offsetHeight : null,
          transform: row ? getComputedStyle(row).transform : null,
        },
      ];
    }),
  );
}
