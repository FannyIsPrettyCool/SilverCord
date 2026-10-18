import {
  GatewayOp,
  guildSchema,
  ownProfileSchema,
  type ProfileUpload,
  profileUploadSchema,
  userProfileSchema,
  userSummariesSchema,
} from '@silvercord/protocol';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, expectError, openRegistration, register } from '../../../test/auth-helpers.ts';
import { TestGatewayClient } from '../../../test/gateway-client.ts';
import { createTestApp, type TestApp } from '../../../test/test-app.ts';
import { guildMembers } from '../guilds/guilds-schema.ts';
import { mediaUploads } from '../media/media-schema.ts';

type Account = Awaited<ReturnType<typeof register>>;
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('profiles', () => {
  let t: TestApp;
  let baseUrl: string;
  let picture: Buffer;
  beforeAll(async () => {
    t = await createTestApp({
      mediaWorker: true,
      presence: { offlineDebounceMs: 100, coalesceMs: 30, sweepMs: 60_000 },
    });
    await openRegistration(t);
    baseUrl = await t.app.listen({ host: '127.0.0.1', port: 0 });
    picture = await sharp({
      create: { width: 400, height: 300, channels: 3, background: { r: 220, g: 40, b: 90 } },
    })
      .png()
      .toBuffer();
  });
  afterAll(() => t.close());

  const id = (account: Account) => account.tokens.user.id;
  const call = (actor: Account, method: Method, url: string, payload?: unknown) =>
    t.request({
      method,
      url: url.startsWith('/media/') ? url : `/api/v1${url}`,
      headers: bearer(actor.tokens),
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  const own = async (actor: Account) =>
    ownProfileSchema.parse((await call(actor, 'GET', '/users/@me/profile')).json());
  async function patch(actor: Account, body: Record<string, unknown>) {
    const { version } = await own(actor);
    const response = await call(actor, 'PATCH', '/users/@me/profile', { version, ...body });
    expect(response.statusCode, response.body).toBe(200);
    return ownProfileSchema.parse(response.json());
  }
  async function view(viewer: Account, subject: Account, guildId?: string) {
    const query = guildId ? `?guildId=${guildId}` : '';
    const response = await call(viewer, 'GET', `/users/${id(subject)}/profile${query}`);
    expect(response.statusCode, response.body).toBe(200);
    return userProfileSchema.parse(response.json());
  }
  async function befriend(a: Account, b: Account) {
    await call(a, 'POST', '/users/@me/relationships', { username: b.account.username });
    expect((await call(b, 'PUT', `/users/@me/relationships/${id(a)}/accept`, {})).statusCode).toBe(
      200,
    );
  }
  async function guildWith(owner: Account, ...members: Account[]) {
    const created = await call(owner, 'POST', '/users/@me/guilds', { name: 'Atlas' });
    expect(created.statusCode, created.body).toBe(201);
    const guild = guildSchema.parse(created.json());
    for (const member of members)
      await t.context.database.db
        .insert(guildMembers)
        .values({ guildId: BigInt(guild.id), userId: BigInt(id(member)) });
    return guild.id;
  }
  async function connect(account: Account) {
    const client = await TestGatewayClient.connect(baseUrl);
    await client.next((frame) => frame.op === GatewayOp.HELLO);
    client.identify(account.tokens.accessToken);
    await client.dispatch('READY');
    return client;
  }
  async function eventually(check: () => Promise<boolean>, timeoutMs = 4000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await check()) return;
      await wait(25);
    }
    throw new Error('condition not reached');
  }
  async function upload(
    actor: Account,
    purpose: string,
    extra: Record<string, unknown> = {},
    crop?: Record<string, number>,
  ): Promise<ProfileUpload> {
    const created = await call(actor, 'POST', '/uploads', {
      purpose,
      filename: 'me.png',
      sizeBytes: picture.length,
      ...extra,
    });
    expect(created.statusCode, created.body).toBe(200);
    const reserved = profileUploadSchema.parse(created.json());
    const chunk = await t.request({
      method: 'PUT',
      url: `/api/v1/uploads/${reserved.id}/chunks`,
      headers: {
        ...bearer(actor.tokens),
        'content-type': 'application/octet-stream',
        'upload-offset': '0',
      },
      payload: picture,
    });
    expect(chunk.statusCode, chunk.body).toBe(200);
    const done = await call(
      actor,
      'POST',
      `/uploads/${reserved.id}/complete`,
      crop ? { crop } : {},
    );
    expect(done.statusCode, done.body).toBe(200);
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const current = profileUploadSchema.parse(
        (await call(actor, 'GET', `/uploads/${reserved.id}`)).json(),
      );
      if (current.state === 'ready' || current.state === 'failed') return current;
      await wait(100);
    }
    throw new Error('upload never settled');
  }

  it('edits fields with optimistic versions and keeps defaults for new accounts', async () => {
    const a = await register(t);
    const fresh = await own(a);
    expect(fresh).toMatchObject({ bio: null, avatar: null, version: 1, customStatus: null });
    expect(fresh.privacy.activity).toBe('mutual_guilds');
    const edited = await patch(a, {
      displayName: 'Aurora',
      bio: '**hi**\nthere',
      pronouns: 'she/they',
      accentColor: 0x6c8cff,
      themeColors: [0x101020, 0xff6bd6],
    });
    expect(edited).toMatchObject({
      displayName: 'Aurora',
      bio: '**hi**\nthere',
      pronouns: 'she/they',
      themeColors: [0x101020, 0xff6bd6],
      version: 2,
    });
    expectError(
      await call(a, 'PATCH', '/users/@me/profile', { version: 1, bio: 'stale' }),
      409,
      'CONFLICT',
    );
    expectError(
      await call(a, 'PATCH', '/users/@me/profile', { version: 2, pronouns: 'x'.repeat(41) }),
      400,
      'VALIDATION_FAILED',
    );
  });

  it('applies each section audience to strangers, co-members, friends, blocked users and self', async () => {
    const owner = await register(t);
    const stranger = await register(t);
    const coMember = await register(t);
    const friend = await register(t);
    const blocker = await register(t);
    await guildWith(owner, coMember);
    await befriend(owner, friend);
    await patch(owner, { bio: 'about me', pronouns: 'he/him' });
    const privacy = (await own(owner)).privacy;
    await call(owner, 'PUT', '/users/@me/profile/privacy', {
      ...privacy,
      bio: 'friends',
      pronouns: 'mutual_guilds',
      memberSince: 'only_me',
    });
    await call(blocker, 'PUT', `/users/@me/blocks/${id(owner)}`, {});

    const seen = async (viewer: Account) => await view(viewer, owner);
    const strangerView = await seen(stranger);
    expect(strangerView.bio).toBeUndefined();
    expect(strangerView.pronouns).toBeUndefined();
    expect(strangerView.memberSince).toBeUndefined();
    expect(strangerView.relationship).toBe('none');

    const memberView = await seen(coMember);
    expect(memberView.pronouns).toBe('he/him');
    expect(memberView.bio).toBeUndefined();
    expect(memberView.mutualGuilds?.count).toBe(1);

    const friendView = await seen(friend);
    expect(friendView).toMatchObject({
      bio: 'about me',
      pronouns: 'he/him',
      relationship: 'friends',
    });
    expect(friendView.memberSince).toBeUndefined();

    const blockedView = await seen(blocker);
    expect(blockedView.relationship).toBe('blocked');
    for (const key of ['bio', 'pronouns', 'banner', 'mutualGuilds', 'mutualFriends'] as const)
      expect(blockedView[key], key).toBeUndefined();

    const selfView = await seen(owner);
    expect(selfView).toMatchObject({ bio: 'about me', pronouns: 'he/him' });
    expect(selfView.memberSince).toBeDefined();
    expectError(await call(owner, 'GET', '/users/999999999/profile'), 404, 'NOT_FOUND');
  });

  it('never shows a custom status to someone who sees the owner as offline', async () => {
    const owner = await register(t);
    const friend = await register(t);
    const stranger = await register(t);
    await befriend(owner, friend);
    const set = await call(owner, 'PUT', '/users/@me/custom-status', {
      text: 'deep work',
      emoji: '🌙',
      expiresAt: null,
    });
    expect(set.statusCode, set.body).toBe(204);
    expect((await view(friend, owner)).customStatus).toBeUndefined();
    const socket = await connect(owner);
    await eventually(async () => (await view(friend, owner)).customStatus?.text === 'deep work');
    expect((await view(stranger, owner)).customStatus).toBeUndefined();
    const summaries = userSummariesSchema.parse(
      (await call(friend, 'GET', `/users/summaries?userIds=${id(owner)}`)).json(),
    );
    expect(summaries.items[0]?.customStatus?.emoji).toBe('🌙');

    await call(owner, 'PATCH', '/users/@me/presence', { status: 'invisible' });
    expect((await view(friend, owner)).customStatus).toBeUndefined();
    expect((await own(owner)).customStatus?.text).toBe('deep work');
    socket.close();

    expectError(
      await call(owner, 'PUT', '/users/@me/custom-status', {
        text: 'past',
        emoji: null,
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      }),
      400,
      'VALIDATION_FAILED',
    );
    expect((await call(owner, 'DELETE', '/users/@me/custom-status')).statusCode).toBe(204);
    expect((await own(owner)).customStatus).toBeNull();
  });

  it('sets, serves and replaces avatars and audience-gated banners', async () => {
    const owner = await register(t);
    const stranger = await register(t);
    const friend = await register(t);
    await befriend(owner, friend);

    const avatar = await upload(owner, 'avatar', {}, { x: 50, y: 0, width: 300, height: 300 });
    expect(avatar.state, JSON.stringify(avatar)).toBe('ready');
    expect(avatar.image).toMatchObject({ width: 512, height: 512, animated: false, still: null });
    const path = avatar.image?.display ?? '';
    // A ready upload is previewable by its owner only, until it is in use.
    expect((await call(owner, 'GET', path)).statusCode).toBe(200);
    expect((await call(stranger, 'GET', path)).statusCode).toBe(404);

    await patch(owner, { avatarUploadId: avatar.id });
    expect((await call(stranger, 'GET', path)).statusCode).toBe(200);
    const summary = userSummariesSchema.parse(
      (await call(stranger, 'GET', `/users/summaries?userIds=${id(owner)}`)).json(),
    ).items[0];
    expect(summary?.avatar?.display).toBe(path);
    expect(summary?.avatar?.dominantColor).not.toBeNull();

    const replacement = await upload(owner, 'avatar');
    await patch(owner, { avatarUploadId: replacement.id });
    expect((await call(stranger, 'GET', path)).statusCode).toBe(404);
    await eventually(async () => {
      const [row] = await t.context.database.db
        .select({ id: mediaUploads.id })
        .from(mediaUploads)
        .where(eq(mediaUploads.id, BigInt(avatar.id)));
      return row === undefined;
    });

    const banner = await upload(owner, 'banner');
    expect(banner.image).toMatchObject({ width: 1500, height: 600 });
    await patch(owner, { bannerUploadId: banner.id });
    const privacy = (await own(owner)).privacy;
    await call(owner, 'PUT', '/users/@me/profile/privacy', { ...privacy, banner: 'friends' });
    const bannerPath = banner.image?.display ?? '';
    expect((await call(friend, 'GET', bannerPath)).statusCode).toBe(200);
    expect((await call(stranger, 'GET', bannerPath)).statusCode).toBe(404);
    expect((await view(stranger, owner)).banner).toBeUndefined();
    expect((await view(friend, owner)).banner?.display).toBe(bannerPath);

    // Uploads are scoped: another user's upload or a mismatched purpose cannot be claimed.
    const foreign = await upload(stranger, 'avatar');
    expectError(
      await call(owner, 'PATCH', '/users/@me/profile', {
        version: (await own(owner)).version,
        avatarUploadId: foreign.id,
      }),
      404,
      'NOT_FOUND',
    );
    const wrongPurpose = await upload(owner, 'banner');
    expectError(
      await call(owner, 'PATCH', '/users/@me/profile', {
        version: (await own(owner)).version,
        avatarUploadId: wrongPurpose.id,
      }),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call(owner, 'POST', '/uploads', {
        purpose: 'avatar',
        filename: 'big.png',
        sizeBytes: 11 * 1024 * 1024,
      }),
      400,
      'VALIDATION_FAILED',
    );
  });

  it('scopes per-server profiles to members and releases them on leave', async () => {
    const owner = await register(t);
    const member = await register(t);
    const outsider = await register(t);
    const guildId = await guildWith(owner, member);

    expectError(
      await call(outsider, 'POST', '/uploads', {
        purpose: 'guild_avatar',
        filename: 'x.png',
        sizeBytes: picture.length,
        guildId,
      }),
      404,
      'NOT_FOUND',
    );
    const avatar = await upload(member, 'guild_avatar', { guildId });
    expect(avatar.state).toBe('ready');
    const updated = await call(member, 'PATCH', `/guilds/${guildId}/members/@me/profile`, {
      nickname: 'Navigator',
      avatarUploadId: avatar.id,
      bio: 'guild bio',
    });
    expect(updated.statusCode, updated.body).toBe(200);

    const inGuild = await view(owner, member, guildId);
    expect(inGuild.avatar?.uploadId).toBe(avatar.id);
    expect(inGuild.bio).toBe('guild bio');
    expect(inGuild.guildMember?.nickname).toBe('Navigator');
    expect((await view(owner, member)).avatar).toBeNull();
    expectError(
      await call(outsider, 'GET', `/users/${id(member)}/profile?guildId=${guildId}`),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call(outsider, 'GET', `/users/summaries?userIds=${id(member)}&guildId=${guildId}`),
      404,
      'NOT_FOUND',
    );
    const summary = userSummariesSchema.parse(
      (
        await call(owner, 'GET', `/users/summaries?userIds=${id(member)}&guildId=${guildId}`)
      ).json(),
    ).items[0];
    expect(summary).toMatchObject({ nickname: 'Navigator' });
    const path = avatar.image?.display ?? '';
    expect((await call(owner, 'GET', path)).statusCode).toBe(200);
    expect((await call(outsider, 'GET', path)).statusCode).toBe(404);

    expect((await call(member, 'DELETE', `/guilds/${guildId}/members/@me`)).statusCode).toBe(204);
    expect((await call(owner, 'GET', path)).statusCode).toBe(404);
  });

  it('publishes PROFILE_CHANGED to friends without content', async () => {
    const owner = await register(t);
    const friend = await register(t);
    await befriend(owner, friend);
    const socket = await connect(friend);
    await patch(owner, { pronouns: 'they/them' });
    const event = await socket.dispatch('PROFILE_CHANGED');
    expect(event.d).toEqual({ userId: id(owner) });
    socket.close();
  });
});
