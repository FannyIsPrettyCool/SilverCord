import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { ALL_PERMISSIONS } from '@silvercord/permissions';
import type {
  Guild,
  GuildChannel,
  GuildChannelCreate,
  GuildChannelPatch,
} from '@silvercord/protocol';

/** Renderer workflow and keyboard behavior with deterministic REST fixtures. Server authorization
 * and transactions are covered by the server's real-Postgres integration suite. */
test('manages a server and channels while preserving Home navigation', async () => {
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'silvercord-guild-ui-'))}`],
    cwd: join(import.meta.dirname, '..'),
    env: { ...process.env, SILVERCORD_API_URL: 'http://localhost:4000' },
  });
  const createdAt = '2026-10-18T00:00:00.000Z';
  const guilds: Guild[] = [];
  const channels: GuildChannel[] = [];
  const errors: string[] = [];
  let rejectNextCreate = true;
  let holdNextCreate = false;
  const releaseCreate = Promise.withResolvers<void>();
  try {
    const page = await app.firstWindow();
    page.on('pageerror', (error) => errors.push(error.message));
    await app.evaluate(({ ipcMain }, at) => {
      const session = {
        user: {
          id: '1',
          username: 'aurora',
          displayName: 'Aurora',
          email: 'aurora@example.test',
          emailVerified: true,
          isInstanceAdmin: false,
          mfaEnabled: false,
          locale: 'en',
          createdAt: at,
        },
        accessToken: 'fixture',
        accessTokenExpiresAt: '2099-01-01T00:00:00.000Z',
        persistent: true,
      };
      ipcMain.removeHandler('auth:login');
      ipcMain.handle('auth:login', () => ({ ok: true, value: { status: 'signed-in', session } }));
      ipcMain.removeHandler('auth:access-token');
      ipcMain.handle('auth:access-token', () => ({ ok: true, value: session }));
      (globalThis as { guildFixtureSession?: typeof session }).guildFixtureSession = session;
    }, createdAt);
    await page.route('http://localhost:4000/api/**', async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      const reply = (json: unknown, status = 200) =>
        route.fulfill({ status, json, headers: { 'access-control-allow-origin': '*' } });
      if (request.method() === 'OPTIONS') return reply({});
      if (path === '/api/v1/users/@me/guilds') {
        if (request.method() === 'GET') return reply({ items: guilds });
        const body = request.postDataJSON() as { name: string };
        const guild: Guild = {
          id: '100',
          name: body.name,
          ownerId: '1',
          version: 1,
          memberCount: 1,
          permissions: ALL_PERMISSIONS.toString(),
          createdAt,
        };
        guilds.push(guild);
        channels.push({
          id: '101',
          guildId: guild.id,
          type: 'guild_text',
          name: 'general',
          parentId: null,
          position: 0,
          topic: null,
          archived: false,
          version: 1,
          lastMessageId: null,
          permissions: ALL_PERMISSIONS.toString(),
          createdAt,
        });
        return reply(guild, 201);
      }
      if (path === '/api/v1/guilds/100') {
        const guild = guilds[0];
        if (guild && request.method() === 'PATCH') {
          guild.name = (request.postDataJSON() as { name: string }).name;
          guild.version += 1;
        }
        return reply(guild);
      }
      if (path === '/api/v1/guilds/100/channels') {
        if (request.method() === 'GET') return reply({ items: channels });
        if (rejectNextCreate) {
          rejectNextCreate = false;
          return reply(
            { error: { code: 'RATE_LIMITED', message: 'Try again' }, requestId: 'fixture' },
            429,
          );
        }
        if (holdNextCreate) {
          holdNextCreate = false;
          await releaseCreate.promise;
        }
        const body = request.postDataJSON() as GuildChannelCreate;
        const channel: GuildChannel = {
          ...body,
          id: String(101 + channels.length),
          guildId: '100',
          parentId: body.parentId ?? null,
          topic: body.topic ?? null,
          position: channels.filter((item) => item.parentId === (body.parentId ?? null)).length,
          archived: false,
          version: 1,
          lastMessageId: null,
          permissions: ALL_PERMISSIONS.toString(),
          createdAt,
        };
        channels.push(channel);
        return reply(channel, 201);
      }
      const match = /^\/api\/v1\/guilds\/100\/channels\/(\d+)$/.exec(path);
      if (match) {
        const channel = channels.find((item) => item.id === match[1]);
        const body = request.postDataJSON() as GuildChannelPatch;
        if (channel) {
          channel.name = body.name ?? channel.name;
          channel.topic = body.topic ?? null;
          channel.version += 1;
        }
        return reply(channel);
      }
      if (path === '/api/v1/users/@me/presence') return reply({ status: 'online' });
      return reply({ items: [], nextBefore: null });
    });

    await page.setViewportSize({ width: 1180, height: 860 });
    await page.goto('app://bundle/index.html?tier=low&still#/sign-in');
    await page.getByLabel('Email or username').fill('aurora');
    await page.getByLabel('Password', { exact: true }).fill('fixture-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('button', { name: 'Create server', exact: true }).click();
    const serverDialog = page.getByRole('dialog', { name: 'Create server' });
    await expect(serverDialog.getByLabel('Server name')).toBeFocused();
    await expect(serverDialog.getByRole('button', { name: 'Create', exact: true })).toBeDisabled();
    await serverDialog.getByLabel('Server name').fill('Night garden');
    await serverDialog.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Night garden' })).toBeVisible();
    await expect(page.getByText('1 member', { exact: true })).toBeVisible();
    await expect(
      page
        .getByRole('navigation', { name: 'Home', exact: true })
        .getByRole('link', { name: 'Home', exact: true }),
    ).not.toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('button', { name: 'Leave server' })).toHaveCount(0);

    await page.setViewportSize({ width: 940, height: 560 });
    await page.getByRole('button', { name: 'Create channel', exact: true }).click();
    const channelDialog = page.getByRole('dialog', { name: 'Create channel' });
    await channelDialog.getByLabel('Channel name').fill('studio');
    await channelDialog.getByLabel('Topic').fill('Sketches and sound');
    await channelDialog
      .getByRole('button', { name: 'Create', exact: true })
      .scrollIntoViewIfNeeded();
    await expect(
      channelDialog.getByRole('button', { name: 'Create', exact: true }),
    ).toBeInViewport();
    await channelDialog.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(channelDialog.getByRole('alert')).toHaveText('Too fast, try again soon');
    await expect(channelDialog.getByLabel('Channel name')).toHaveValue('studio');
    await channelDialog.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'studio', exact: true })).toBeVisible();
    await expect(
      page.getByRole('paragraph').filter({ hasText: 'Sketches and sound' }),
    ).toBeVisible();
    await expect(page.getByText('Messaging unavailable')).toBeVisible();
    await expect(page.getByRole('textbox')).toHaveCount(0);
    await page.getByRole('button', { name: 'Edit channel', exact: true }).click();
    const edit = page.getByRole('dialog', { name: 'Edit channel' });
    await edit.getByLabel('Channel name').fill('sketchbook');
    await edit.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(
      page
        .getByRole('navigation', { name: 'Channels', exact: true })
        .getByRole('link', { name: 'sketchbook' }),
    ).toHaveAttribute('aria-current', 'page');
    await page.getByRole('button', { name: 'Rename server', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Rename server' })
      .getByLabel('Server name')
      .fill('Evening garden');
    await page
      .getByRole('dialog', { name: 'Rename server' })
      .getByRole('button', { name: 'Save', exact: true })
      .click();
    await expect(page.getByRole('heading', { name: 'Evening garden' })).toBeVisible();
    await page.setViewportSize({ width: 1180, height: 860 });
    mkdirSync(join(import.meta.dirname, '../../../.artifacts/shots'), { recursive: true });
    await page.screenshot({
      path: join(import.meta.dirname, '../../../.artifacts/shots/phase3-guild.png'),
    });
    // A completed request from a dismissed form cannot hijack the next form instance.
    holdNextCreate = true;
    await page.getByRole('button', { name: 'Create channel', exact: true }).click();
    await channelDialog.getByLabel('Channel name').fill('old-request');
    await channelDialog
      .getByRole('button', { name: 'Create', exact: true })
      .click({ noWaitAfter: true });
    await expect.poll(() => holdNextCreate).toBe(false);
    await page.keyboard.press('Escape');
    await expect(channelDialog).not.toBeVisible();
    await page.getByRole('button', { name: 'Create channel', exact: true }).click();
    await channelDialog.getByLabel('Channel name').fill('new draft');
    releaseCreate.resolve();
    await expect(
      page
        .getByRole('navigation', { name: 'Channels', exact: true })
        .getByRole('link', { name: 'old-request', exact: true }),
    ).toBeVisible();
    await expect(channelDialog).toBeVisible();
    await expect(channelDialog.getByLabel('Channel name')).toHaveValue('new draft');
    await expect(page.getByRole('heading', { name: 'Evening garden', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await page
      .getByRole('navigation', { name: 'Home', exact: true })
      .getByRole('link', { name: 'Home', exact: true })
      .click();
    await expect(page.getByRole('navigation', { name: 'Conversations' })).toBeVisible();

    // A fresh French session with ordinary permissions must not offer privileged controls.
    const guild = guilds[0];
    if (!guild) throw new Error('fixture guild missing');
    guild.ownerId = '2';
    guild.permissions = '1';
    for (const channel of channels) channel.permissions = '1';
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('auth:restore');
      ipcMain.handle('auth:restore', () => ({
        ok: true,
        value: (globalThis as { guildFixtureSession?: unknown }).guildFixtureSession,
      }));
    });
    await page.addInitScript(() =>
      Object.defineProperty(navigator, 'languages', { get: () => ['fr-FR'] }),
    );
    await page.setViewportSize({ width: 940, height: 560 });
    await page.goto(
      'app://bundle/index.html?tier=low&still&locale-check=fr#/app/guilds/100/channels/102',
    );
    await expect(page.getByRole('heading', { name: 'sketchbook', exact: true })).toBeVisible();
    await expect(page.getByText('Messages indisponibles')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Créer un salon', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Modifier le salon', exact: true })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole('button', { name: 'Renommer le serveur', exact: true }),
    ).toHaveCount(0);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow).toBe(false);
    await page.screenshot({
      path: join(import.meta.dirname, '../../../.artifacts/shots/phase3-guild-fr-small.png'),
    });
    await page.getByRole('button', { name: 'Créer un serveur', exact: true }).click();
    const frenchDialog = page.getByRole('dialog', { name: 'Créer un serveur' });
    await expect(frenchDialog.getByLabel('Nom du serveur')).toBeFocused();
    await frenchDialog.evaluate(async (element) => {
      await Promise.all(element.getAnimations().map((animation) => animation.finished));
    });
    await page.screenshot({
      path: join(import.meta.dirname, '../../../.artifacts/shots/phase3-guild-fr-dialog.png'),
    });
    await page.keyboard.press('Escape');
    await expect(frenchDialog).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Créer un serveur', exact: true })).toBeFocused();
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
