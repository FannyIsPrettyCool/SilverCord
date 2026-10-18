import { mkdirSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { API, conversationLink } from './clients.ts';
import { machineClient, transcriptGeometry } from './machine-client.ts';

const role = process.env['SILVERCORD_ACCEPTANCE_ROLE'];
const marker = process.env['SILVERCORD_ACCEPTANCE_MARKER'] ?? '';
const output = process.env['SILVERCORD_ACCEPTANCE_OUTPUT'] ?? '';
const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWPwv/EfK2IYWhIAjeOJgc+7TuYAAAAASUVORK5CYII=';

/** Run once on Windows and once on Linux, coordinated by real DM messages + a ready file. */
test('Windows and VPS Electron clients exchange messages, typing, reads, edits, reactions and media', async () => {
  test.skip(
    role !== 'windows' && role !== 'linux',
    'Use tools/scripts/cross-machine-acceptance.sh',
  );
  test.setTimeout(240_000);
  expect(marker).toMatch(/^machine-[a-z0-9-]+$/);
  expect(output).not.toBe('');
  expect(process.platform).toBe(role === 'linux' ? 'linux' : 'win32');
  // Never run known development seed credentials against a public instance.
  expect(['http://127.0.0.1:14100', 'http://127.0.0.1:14400']).toContain(API);
  mkdirSync(output, { recursive: true });
  const { app, page, events } = await machineClient(role === 'linux' ? 'tide' : 'aurora');
  const checks: string[] = [];
  try {
    const article = (text: string) => page.getByRole('article').filter({ hasText: text });
    const send = async (text: string) => {
      const composer = page.getByRole('textbox', {
        name: role === 'linux' ? 'Message Aurora' : 'Message Tide',
      });
      await composer.fill(text);
      await composer.press('Enter');
      await expect(article(text)).toBeVisible({ timeout: 15_000 });
    };
    if (role === 'linux') {
      const conversation = conversationLink(page, 'Aurora');
      const badge = conversation.getByText(/^\d+$/);
      await conversation.click();
      await expect(badge).toBeHidden({ timeout: 15_000 });
      await page.getByRole('link', { name: 'Friends', exact: true }).click();
      writeFileSync(
        join(output, 'ready.json'),
        JSON.stringify({ marker, platform: process.platform, host: hostname() }),
      );
      await expect(badge).toBeVisible({ timeout: 120_000 });
      await page.screenshot({ path: join(output, 'unread.png') });
      await conversation.click();
      await expect(article(`probe-${marker}`)).toBeVisible({ timeout: 15_000 });
      await expect(badge).toBeHidden({ timeout: 15_000 });
      checks.push('windows message delivery', 'unread badge', 'read acknowledgement');
      await send(`ready-${marker}`);
      await expect(page.getByText('Aurora is typing')).toBeVisible({ timeout: 30_000 });
      checks.push('live Windows typing');
      await send(`typing-ok-${marker}`);
      const received = article(`hello tide ${marker}`);
      await expect(received).toBeVisible({ timeout: 30_000 });
      await expect(received.locator('strong')).toHaveText('tide');
      checks.push('markdown delivery');
      await received.hover();
      await received.getByRole('button', { name: 'Add reaction' }).click();
      await page.getByRole('button', { name: '🎉', exact: true }).click();
      await expect(article(`edited-${marker}`)).toContainText('(edited)', { timeout: 30_000 });
      checks.push('live Windows edit');
      await send(`edit-ok-${marker}`);
      const image = page.getByRole('img', { name: `pixel-${marker}.png` });
      await expect(image).toBeVisible({ timeout: 60_000 });
      await expect
        .poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth))
        .toBeGreaterThan(0);
      checks.push('authorized decoded image delivery');
      await send(`done-${marker}`);
    } else {
      await conversationLink(page, 'Tide').click();
      await send(`probe-${marker}`);
      await expect(article(`ready-${marker}`)).toBeVisible({ timeout: 60_000 });
      checks.push('Linux message delivery');
      const composer = page.getByRole('textbox', { name: 'Message Tide' });
      await composer.pressSequentially('typing across machines', { delay: 80 });
      await expect(article(`typing-ok-${marker}`)).toBeVisible({ timeout: 20_000 });
      await composer.fill(`hello **tide** ${marker}`);
      await composer.press('Enter');
      const sent = article(`hello tide ${marker}`);
      await expect(sent.getByRole('button', { name: /🎉/ })).toBeVisible({ timeout: 20_000 });
      checks.push('live Linux reaction', 'Linux typing observation acknowledged');
      await sent.hover();
      await sent.getByRole('button', { name: 'Edit' }).click();
      const editor = page.getByRole('textbox', { name: 'Edit message' });
      await editor.fill(`edited-${marker}`);
      await editor.press('Enter');
      await expect(article(`edit-ok-${marker}`)).toBeVisible({ timeout: 30_000 });
      await page.locator('input[type="file"]').setInputFiles({
        name: `pixel-${marker}.png`,
        mimeType: 'image/png',
        buffer: Buffer.from(png, 'base64'),
      });
      await expect(page.getByText('Ready', { exact: true })).toBeVisible({ timeout: 45_000 });
      await composer.press('Enter');
      await expect(article(`done-${marker}`)).toBeVisible({ timeout: 60_000 });
      checks.push('Linux edit and image observation acknowledged');
    }
    expect(events).toContain('MESSAGE_CHANGED');
    expect(events).toContain('READ_STATE_CHANGED');
    if (role === 'linux') expect(events).toContain('TYPING_CHANGED');
    await page.evaluate(() => document.fonts.ready);
    let previousGeometry = '';
    let stableSamples = 0;
    await expect
      .poll(
        async () => {
          const rows = await transcriptGeometry(page);
          const serialized = JSON.stringify(rows);
          stableSamples = serialized === previousGeometry ? stableSamples + 1 : 0;
          previousGeometry = serialized;
          writeFileSync(join(output, 'transcript-geometry.json'), JSON.stringify(rows, null, 2));
          const overlaps = rows.flatMap((row, index) => {
            const previous = rows[index - 1];
            return previous && previous.bottom > row.top + 1
              ? [{ previous: previous.id, next: row.id, pixels: previous.bottom - row.top }]
              : [];
          });
          return { overlaps, stable: rows.length > 0 && stableSamples >= 2 };
        },
        { timeout: 10_000 },
      )
      .toEqual({ overlaps: [], stable: true });
    checks.push('settled transcript rows and descendants do not overlap');
    await page.screenshot({ path: join(output, 'complete.png') });
    const runtime = await app.evaluate(() => ({
      platform: process.platform,
      electron: process.versions.electron,
    }));
    writeFileSync(
      join(output, 'result.json'),
      JSON.stringify(
        {
          passed: true,
          role,
          marker,
          host: hostname(),
          api: API,
          runtime,
          checks,
          gatewayEvents: [...new Set(events)],
          completedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } catch (error) {
    await page.screenshot({ path: join(output, 'failure.png') }).catch(() => undefined);
    throw error;
  } finally {
    await app.close();
  }
});
