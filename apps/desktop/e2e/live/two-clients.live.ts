import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { API, type Client, conversationLink, signedInClient } from './clients.ts';

/**
 * Phase 2 acceptance (docs/PLAN.md): two independent clients chat in a DM through the server,
 * with typing, unread badges, reactions and edits arriving over the real gateway.
 */
test.beforeAll(async () => {
  const health = await fetch(`${API}/health`).catch(() => null);
  expect(health?.ok, `server not reachable at ${API}`).toBe(true);
});

test('aurora and tide chat in their DM in real time', async () => {
  const clients: Client[] = [];
  try {
    const aurora = await signedInClient('aurora');
    clients.push(aurora);
    const tide = await signedInClient('tide');
    clients.push(tide);

    // Tide stays on the friends view so the sidebar badge can count the new message.
    await conversationLink(aurora.page, 'Tide').click();
    const composer = aurora.page.getByRole('textbox', { name: 'Message Tide' });
    await expect(composer).toBeVisible();

    await composer.click();
    await composer.pressSequentially('typing check');
    await expect(conversationLink(tide.page, 'Aurora')).toBeVisible();
    await conversationLink(tide.page, 'Aurora').click();
    await expect(tide.page.getByText('Aurora is typing')).toBeVisible({ timeout: 10_000 });
    await aurora.page.keyboard.press('Control+A');
    await aurora.page.keyboard.press('Backspace');

    await tide.page.getByRole('link', { name: 'Friends' }).click();
    const marker = `live-${randomUUID().slice(0, 8)}`;
    await composer.pressSequentially(`hello **tide** ${marker}`);
    await aurora.page.keyboard.press('Enter');
    await expect(aurora.page.getByRole('article').filter({ hasText: marker })).toBeVisible();

    const badge = conversationLink(tide.page, 'Aurora').getByText(/^\d+$/);
    await expect(badge).toBeVisible({ timeout: 10_000 });
    await conversationLink(tide.page, 'Aurora').click();
    const received = tide.page.getByRole('article').filter({ hasText: marker });
    await expect(received).toBeVisible({ timeout: 10_000 });
    await expect(received.locator('strong')).toHaveText('tide');
    await expect(badge).toBeHidden({ timeout: 10_000 });

    // Tide reacts; aurora's copy updates without reloading.
    await received.hover();
    await received.getByRole('button', { name: 'Add reaction' }).click();
    await tide.page.getByRole('button', { name: '🎉' }).click();
    const auroraCopy = aurora.page.getByRole('article').filter({ hasText: marker });
    await expect(auroraCopy.getByRole('button', { name: /🎉/ })).toBeVisible({ timeout: 10_000 });

    // Aurora edits; tide sees the new text and the edited marker.
    await auroraCopy.hover();
    await auroraCopy.getByRole('button', { name: 'Edit' }).click();
    const editor = aurora.page.getByRole('textbox', { name: 'Edit message' });
    await editor.fill(`edited ${marker}`);
    await editor.press('Enter');
    await expect(
      tide.page.getByRole('article').filter({ hasText: `edited ${marker}` }),
    ).toContainText('(edited)', { timeout: 10_000 });
  } finally {
    for (const client of clients) await client.app.close();
  }
});
