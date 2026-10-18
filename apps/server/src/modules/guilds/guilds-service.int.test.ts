import { ALL_PERMISSIONS, DEFAULT_EVERYONE_PERMISSIONS, Permission } from '@silvercord/permissions';
import { guildListSchema, guildSchema } from '@silvercord/protocol';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, expectError, openRegistration, register } from '../../../test/auth-helpers.ts';
import { createTestApp, type TestApp } from '../../../test/test-app.ts';
import { createEventOutbox } from '../../events/outbox.ts';
import { eventOutbox } from '../../events/outbox-schema.ts';
import { channels } from '../channels/channels-schema.ts';
import { users } from '../users/users-schema.ts';
import { createGuildPermissionsService } from './guild-permissions.ts';
import { auditLog, guildMembers, guilds, memberRoles, roles } from './guilds-schema.ts';
import { createGuildsService } from './guilds-service.ts';

describe('guild lifecycle and authorization', () => {
  let t: TestApp;
  let sequence = 10_000n;
  const nextId = () => sequence++;
  const outbox = createEventOutbox(nextId);
  const permissions = createGuildPermissionsService();
  const service = createGuildsService({
    nextId,
    outbox,
    permissions,
    createDefaultChannel: async (tx, guildId) => {
      await tx
        .insert(channels)
        .values({ id: nextId(), guildId, type: 'guild_text', name: 'general' });
    },
  });
  beforeAll(async () => {
    t = await createTestApp();
    await openRegistration(t);
  });
  afterAll(() => t.close());
  const db = () => t.context.database.db;
  async function user() {
    const id = nextId();
    await db()
      .insert(users)
      .values({
        id,
        username: `guilduser${id}`,
        email: `guilduser${id}@example.test`,
        passwordHash: 'unused',
        locale: 'en',
        ageConfirmedAt: new Date(),
      });
    return id;
  }
  async function fixture() {
    const ownerId = await user();
    const memberId = await user();
    const guild = await service.create(db(), ownerId, { name: 'Aurora' });
    const guildId = BigInt(guild.id);
    await db().insert(guildMembers).values({ guildId, userId: memberId });
    return { ownerId, memberId, guildId, guild };
  }

  it('creates owner membership, default role, general channel, audit and event atomically', async () => {
    const ownerId = await user();
    const guild = await service.create(db(), ownerId, { name: 'Workshop' });
    const guildId = BigInt(guild.id);
    expect(guildSchema.parse(guild)).toMatchObject({
      ownerId: ownerId.toString(),
      memberCount: 1,
      version: 1,
      permissions: ALL_PERMISSIONS.toString(),
    });
    expect(await service.list(db(), ownerId)).toEqual([guild]);
    expect(await db().select().from(roles).where(eq(roles.guildId, guildId))).toMatchObject([
      { id: guildId, position: 0, permissions: DEFAULT_EVERYONE_PERMISSIONS },
    ]);
    expect(await db().select().from(channels).where(eq(channels.guildId, guildId))).toMatchObject([
      { name: 'general', type: 'guild_text' },
    ]);
    expect(await db().select().from(auditLog).where(eq(auditLog.guildId, guildId))).toMatchObject([
      { action: 'GUILD_CREATE', actorId: ownerId },
    ]);
    expect(
      await db().select().from(eventOutbox).where(eq(eventOutbox.recipientUserId, ownerId)),
    ).toMatchObject([{ type: 'GUILD_CHANGED', payload: { guildId: guild.id } }]);
  });

  it('rolls back every creation row if default channel setup fails', async () => {
    const ownerId = await user();
    const failed = createGuildsService({
      nextId,
      outbox,
      permissions,
      createDefaultChannel: async () => {
        throw new Error('channel creation failed');
      },
    });
    await expect(failed.create(db(), ownerId, { name: 'Rollback' })).rejects.toThrow(
      'channel creation failed',
    );
    expect(await db().select().from(guilds).where(eq(guilds.ownerId, ownerId))).toEqual([]);
    expect(await db().select().from(guildMembers).where(eq(guildMembers.userId, ownerId))).toEqual(
      [],
    );
    expect(await db().select().from(auditLog).where(eq(auditLog.actorId, ownerId))).toEqual([]);
    expect(
      await db().select().from(eventOutbox).where(eq(eventOutbox.recipientUserId, ownerId)),
    ).toEqual([]);
  });

  it('hides nonmember servers and rechecks current management permissions and versions', async () => {
    const f = await fixture();
    const outsider = await user();
    await expect(service.view(db(), outsider, f.guildId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      service.rename(db(), f.memberId, f.guildId, { name: 'Denied', expectedVersion: 1 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const roleId = nextId();
    await db().insert(roles).values({
      id: roleId,
      guildId: f.guildId,
      name: 'Manager',
      permissions: Permission.MANAGE_GUILD,
      position: 1,
    });
    await db().insert(memberRoles).values({ guildId: f.guildId, userId: f.memberId, roleId });
    expect(
      await service.rename(db(), f.memberId, f.guildId, { name: 'New name', expectedVersion: 1 }),
    ).toMatchObject({ name: 'New name', version: 2 });
    await expect(
      service.rename(db(), f.ownerId, f.guildId, { name: 'Stale', expectedVersion: 1 }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await db().delete(memberRoles).where(eq(memberRoles.roleId, roleId));
    await expect(
      service.rename(db(), f.memberId, f.guildId, { name: 'Revoked', expectedVersion: 2 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(
      await db()
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.guildId, f.guildId), eq(auditLog.action, 'GUILD_UPDATE'))),
    ).toMatchObject([
      { actorId: f.memberId, changes: { name: { before: 'Aurora', after: 'New name' } } },
    ]);
  });

  it('prevents owner departure and removes member roles while invalidating both accounts', async () => {
    const f = await fixture();
    await expect(service.leave(db(), f.ownerId, f.guildId)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    const roleId = nextId();
    await db()
      .insert(roles)
      .values({ id: roleId, guildId: f.guildId, name: 'Member', permissions: 0n, position: 1 });
    await db().insert(memberRoles).values({ guildId: f.guildId, userId: f.memberId, roleId });
    await service.leave(db(), f.memberId, f.guildId);
    expect(await service.list(db(), f.memberId)).toEqual([]);
    await expect(service.view(db(), f.memberId, f.guildId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await db().select().from(memberRoles).where(eq(memberRoles.roleId, roleId))).toEqual([]);
    for (const recipient of [f.ownerId, f.memberId]) {
      const events = await db()
        .select()
        .from(eventOutbox)
        .where(eq(eventOutbox.recipientUserId, recipient));
      expect(events.map((event) => event.type)).toContain('GUILD_MEMBERS_CHANGED');
      expect(events.map((event) => event.type)).toContain('GUILD_CHANGED');
    }
  });

  async function seedMemberships(ownerId: bigint, userId: bigint, count: number) {
    for (let index = 0; index < count; index++) {
      const guildId = nextId();
      await db()
        .insert(guilds)
        .values({ id: guildId, ownerId, name: `Seed ${index}` });
      await db().insert(guildMembers).values({ guildId, userId });
      await db().insert(roles).values({
        id: guildId,
        guildId,
        name: '@everyone',
        permissions: DEFAULT_EVERYONE_PERMISSIONS,
        position: 0,
      });
    }
  }

  it('serializes concurrent creations at the 25-owned limit', async () => {
    const ownerId = await user();
    await seedMemberships(ownerId, ownerId, 24);
    const results = await Promise.allSettled([
      service.create(db(), ownerId, { name: 'Last slot A' }),
      service.create(db(), ownerId, { name: 'Last slot B' }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toMatchObject([
      { reason: { code: 'CONFLICT' } },
    ]);
    expect(await service.list(db(), ownerId)).toHaveLength(25);
  });

  it('serializes concurrent creations at the 100-membership limit', async () => {
    const ownerId = await user();
    const memberId = await user();
    await seedMemberships(ownerId, memberId, 99);
    const results = await Promise.allSettled([
      service.create(db(), memberId, { name: 'Last slot A' }),
      service.create(db(), memberId, { name: 'Last slot B' }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toMatchObject([
      { reason: { code: 'CONFLICT' } },
    ]);
    expect(await service.list(db(), memberId)).toHaveLength(100);
  });

  it('authenticates and validates routes and applies fresh membership and rename guards', async () => {
    const owner = await register(t);
    const outsider = await register(t);
    const call = (
      method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
      url: string,
      payload?: Record<string, unknown>,
      token = owner.tokens,
    ) => t.request({ method, url, headers: bearer(token), ...(payload ? { payload } : {}) });
    expectError(
      await t.request({ method: 'GET', url: '/api/v1/users/@me/guilds' }),
      401,
      'UNAUTHENTICATED',
    );
    expectError(
      await call('POST', '/api/v1/users/@me/guilds', { name: '  ' }),
      400,
      'VALIDATION_FAILED',
    );
    const created = await call('POST', '/api/v1/users/@me/guilds', { name: ' HTTP server ' });
    expect(created.statusCode, created.body).toBe(201);
    const guild = guildSchema.parse(created.json());
    expect(guild.name).toBe('HTTP server');
    expect(
      guildListSchema.parse((await call('GET', '/api/v1/users/@me/guilds')).json()).items,
    ).toEqual([guild]);
    const path = `/api/v1/guilds/${guild.id}`;
    expectError(await call('GET', path, undefined, outsider.tokens), 404, 'NOT_FOUND');
    await db()
      .insert(guildMembers)
      .values({ guildId: BigInt(guild.id), userId: BigInt(outsider.tokens.user.id) });
    expectError(
      await call('PATCH', path, { name: 'Denied', expectedVersion: 1 }, outsider.tokens),
      403,
      'FORBIDDEN',
    );
    expect((await call('PATCH', path, { name: 'Updated', expectedVersion: 1 })).statusCode).toBe(
      200,
    );
    expectError(await call('DELETE', `${path}/members/@me`), 403, 'FORBIDDEN');
    expect(
      (await call('DELETE', `${path}/members/@me`, undefined, outsider.tokens)).statusCode,
    ).toBe(204);
    expectError(await call('GET', path, undefined, outsider.tokens), 404, 'NOT_FOUND');
  });
});
