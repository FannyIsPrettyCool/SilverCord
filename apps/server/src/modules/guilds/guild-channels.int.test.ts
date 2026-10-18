import { CHANNEL_SCOPE, DEFAULT_EVERYONE_PERMISSIONS, Permission } from '@silvercord/permissions';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase } from '../../../test/database.ts';
import { createEventOutbox } from '../../events/outbox.ts';
import { channelOverwrites, channels } from '../channels/channels-schema.ts';
import { users } from '../users/users-schema.ts';
import { createGuildChannelsService } from './guild-channels-service.ts';
import { createGuildPermissionsService } from './guild-permissions.ts';
import { auditLog, guildMembers, guilds, roles } from './guilds-schema.ts';

describe('guild channels and category isolation', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let sequence = 9_000n;
  const nextId = () => sequence++;
  const service = createGuildChannelsService({
    nextId,
    outbox: createEventOutbox(nextId),
    permissions: createGuildPermissionsService(),
  });
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(() => database.close());

  async function fixture() {
    const ownerId = nextId();
    const memberId = nextId();
    const guildId = nextId();
    await database.db.insert(users).values(
      [ownerId, memberId].map((id) => ({
        id,
        username: `channeluser${id}`,
        email: `channel${id}@example.test`,
        passwordHash: 'unused',
        locale: 'en' as const,
        ageConfirmedAt: new Date(),
      })),
    );
    await database.db.transaction(async (tx) => {
      await tx.insert(guilds).values({ id: guildId, name: 'Guild', ownerId });
      await tx.insert(guildMembers).values([
        { guildId, userId: ownerId },
        { guildId, userId: memberId },
      ]);
      await tx.insert(roles).values({
        id: guildId,
        guildId,
        name: '@everyone',
        position: 0,
        permissions: DEFAULT_EVERYONE_PERMISSIONS,
      });
      await service.createDefaultChannel(tx, guildId);
    });
    return { guildId, ownerId, memberId };
  }

  it('creates general without private memberships and audits category children', async () => {
    const f = await fixture();
    const initial = await service.list(database.db, f.memberId, f.guildId);
    expect(initial).toMatchObject([{ name: 'general', type: 'guild_text', position: 0 }]);
    const category = await service.create(database.db, f.ownerId, f.guildId, {
      type: 'guild_category',
      name: 'Community',
    });
    const child = await service.create(database.db, f.ownerId, f.guildId, {
      type: 'guild_voice',
      name: 'Lounge',
      parentId: category.id,
    });
    expect(child).toMatchObject({ parentId: category.id, position: 0 });
    expect(
      await database.db.select().from(auditLog).where(eq(auditLog.guildId, f.guildId)),
    ).toHaveLength(2);
  });

  it('copies category overwrites and hides both category and child from denied members', async () => {
    const f = await fixture();
    const category = await service.create(database.db, f.ownerId, f.guildId, {
      type: 'guild_category',
      name: 'Staff',
    });
    await database.db.insert(channelOverwrites).values({
      channelId: BigInt(category.id),
      targetType: 'member',
      targetId: f.memberId,
      deny: Permission.VIEW_CHANNEL,
    });
    const child = await service.create(database.db, f.ownerId, f.guildId, {
      type: 'guild_text',
      name: 'staff-chat',
      parentId: category.id,
    });
    expect(
      (await service.list(database.db, f.memberId, f.guildId)).map(({ name }) => name),
    ).toEqual(['general']);
    expect(
      await database.db
        .select()
        .from(channelOverwrites)
        .where(eq(channelOverwrites.channelId, BigInt(child.id))),
    ).toMatchObject([{ targetId: f.memberId, deny: Permission.VIEW_CHANNEL }]);
  });

  it('requires current permission on each mutation and conceals inaccessible channels', async () => {
    const f = await fixture();
    await expect(
      service.create(database.db, f.memberId, f.guildId, { type: 'announcement', name: 'News' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const created = await service.create(database.db, f.ownerId, f.guildId, {
      type: 'announcement',
      name: 'News',
    });
    await database.db.insert(channelOverwrites).values({
      channelId: BigInt(created.id),
      targetType: 'member',
      targetId: f.memberId,
      deny: Permission.VIEW_CHANNEL,
    });
    await expect(
      service.patch(database.db, f.memberId, f.guildId, BigInt(created.id), {
        name: 'Changed',
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await database.db
      .update(roles)
      .set({ permissions: DEFAULT_EVERYONE_PERMISSIONS | Permission.MANAGE_CHANNELS })
      .where(eq(roles.id, f.guildId));
    await service.create(database.db, f.memberId, f.guildId, {
      type: 'guild_text',
      name: 'Allowed',
    });
    await database.db
      .update(roles)
      .set({ permissions: DEFAULT_EVERYONE_PERMISSIONS })
      .where(eq(roles.id, f.guildId));
    await expect(
      service.create(database.db, f.memberId, f.guildId, { type: 'guild_text', name: 'Revoked' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects cross-guild parents, noncategory parents and mismatched nested channel ids', async () => {
    const a = await fixture();
    const b = await fixture();
    const category = await service.create(database.db, a.ownerId, a.guildId, {
      type: 'guild_category',
      name: 'A',
    });
    await expect(
      service.create(database.db, b.ownerId, b.guildId, {
        type: 'guild_text',
        name: 'Wrong',
        parentId: category.id,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const general = (await service.list(database.db, a.ownerId, a.guildId))[0];
    if (!general) throw new Error('general channel missing');
    await expect(
      service.create(database.db, a.ownerId, a.guildId, {
        type: 'guild_voice',
        name: 'Wrong',
        parentId: general.id,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      service.patch(database.db, b.ownerId, b.guildId, BigInt(category.id), {
        name: 'Wrong',
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('checks optimistic versions and preserves untouched fields', async () => {
    const f = await fixture();
    const channel = await service.create(database.db, f.ownerId, f.guildId, {
      type: 'guild_text',
      name: 'Chat',
      topic: 'Hello',
    });
    const updated = await service.patch(database.db, f.ownerId, f.guildId, BigInt(channel.id), {
      name: 'Renamed',
      expectedVersion: 1,
    });
    expect(updated).toMatchObject({ name: 'Renamed', topic: 'Hello', version: 2 });
    await expect(
      service.patch(database.db, f.ownerId, f.guildId, BigInt(channel.id), {
        topic: null,
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('conceals a hidden parent category in list and patch responses for a visible child', async () => {
    const f = await fixture();
    const category = await service.create(database.db, f.ownerId, f.guildId, {
      type: 'guild_category',
      name: 'Secret category',
    });
    const child = await service.create(database.db, f.ownerId, f.guildId, {
      type: 'guild_text',
      name: 'Public chat',
      parentId: category.id,
    });
    await database.db
      .update(roles)
      .set({ permissions: DEFAULT_EVERYONE_PERMISSIONS | Permission.MANAGE_CHANNELS })
      .where(eq(roles.id, f.guildId));
    await database.db.insert(channelOverwrites).values({
      channelId: BigInt(category.id),
      targetType: 'member',
      targetId: f.memberId,
      deny: Permission.VIEW_CHANNEL,
    });
    const visible = await service.list(database.db, f.memberId, f.guildId);
    expect(visible.find(({ id }) => id === child.id)?.parentId).toBeNull();
    expect(JSON.stringify(visible)).not.toContain('Secret category');
    expect(JSON.stringify(visible)).not.toContain(category.id);
    const patched = await service.patch(database.db, f.memberId, f.guildId, BigInt(child.id), {
      name: 'Renamed public chat',
      expectedVersion: child.version,
    });
    expect(patched.parentId).toBeNull();
    expect(JSON.stringify(patched)).not.toContain(category.id);
  });

  it('reorders complete channel sets atomically and rejects cycles and stale sets', async () => {
    const f = await fixture();
    const category = await service.create(database.db, f.ownerId, f.guildId, {
      type: 'guild_category',
      name: 'Category',
    });
    const all = await service.list(database.db, f.ownerId, f.guildId);
    const general = all.find(({ name }) => name === 'general');
    if (!general) throw new Error('general channel missing');
    const categoryOrder = { id: category.id, parentId: null, position: 0 };
    const generalOrder = { id: general.id, parentId: category.id, position: 0 };
    const items = [categoryOrder, generalOrder];
    expect(
      await service.reorder(database.db, f.ownerId, f.guildId, { items, expectedVersion: 2 }),
    ).toMatchObject([{ id: general.id, parentId: category.id }, { id: category.id }]);
    await expect(
      service.reorder(database.db, f.ownerId, f.guildId, {
        expectedVersion: 3,
        items: [{ ...categoryOrder, parentId: general.id }, generalOrder],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      service.reorder(database.db, f.ownerId, f.guildId, {
        items: [categoryOrder],
        expectedVersion: 3,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(
      service.reorder(database.db, f.ownerId, f.guildId, { items, expectedVersion: 2 }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(
      (await service.list(database.db, f.ownerId, f.guildId)).find(({ id }) => id === category.id)
        ?.parentId,
    ).toBeNull();
  });

  it('enforces guild isolation and overwrite bit scope in PostgreSQL', async () => {
    const a = await fixture();
    const b = await fixture();
    const category = await service.create(database.db, a.ownerId, a.guildId, {
      type: 'guild_category',
      name: 'Category',
    });
    await expect(
      database.db.insert(channels).values({
        id: nextId(),
        guildId: b.guildId,
        type: 'guild_text',
        name: 'Cross-guild',
        parentId: BigInt(category.id),
      }),
    ).rejects.toMatchObject({
      cause: { code: '23503', constraint_name: 'channels_parent_guild_fk' },
    });
    await expect(
      database.db.insert(channelOverwrites).values({
        channelId: BigInt(category.id),
        targetType: 'role',
        targetId: a.guildId,
        allow: Permission.ADMINISTRATOR,
      }),
    ).rejects.toMatchObject({
      cause: { code: '23514', constraint_name: 'channel_overwrites_scope' },
    });
    await database.db.insert(channelOverwrites).values({
      channelId: BigInt(category.id),
      targetType: 'role',
      targetId: a.guildId,
      allow: CHANNEL_SCOPE,
    });
    await database.db.delete(guilds).where(eq(guilds.id, a.guildId));
    expect(
      await database.db.select().from(channels).where(eq(channels.guildId, a.guildId)),
    ).toEqual([]);
    expect(
      await database.db
        .select()
        .from(channelOverwrites)
        .where(
          and(
            eq(channelOverwrites.channelId, BigInt(category.id)),
            eq(channelOverwrites.targetId, a.guildId),
          ),
        ),
    ).toEqual([]);
  });

  it('keeps channel metadata and permissions in one snapshot during revocation', async () => {
    const f = await fixture();
    const reader = createGuildPermissionsService();
    let revoked = false;
    const racing = createGuildChannelsService({
      nextId,
      outbox: createEventOutbox(nextId),
      permissions: {
        ...reader,
        async guildChannels(ex, guildId, userId) {
          const access = await reader.guildChannels(ex, guildId, userId);
          if (!revoked) {
            revoked = true;
            await database.db.transaction(async (tx) => {
              await tx.select().from(guilds).where(eq(guilds.id, guildId)).for('update');
              await tx.update(roles).set({ permissions: 0n }).where(eq(roles.id, guildId));
              await tx
                .update(channels)
                .set({ name: 'new-hidden-name', topic: 'new-hidden-topic' })
                .where(eq(channels.guildId, guildId));
            });
          }
          return access;
        },
      },
    });
    const before = await racing.list(database.db, f.memberId, f.guildId);
    expect(before).toMatchObject([{ name: 'general', topic: null }]);
    expect(JSON.stringify(before)).not.toContain('new-hidden');
    expect(await racing.list(database.db, f.memberId, f.guildId)).toEqual([]);
  });

  it('serializes concurrent creates at the guild channel cap', async () => {
    const f = await fixture();
    await database.db.insert(channels).values(
      Array.from({ length: 498 }, (_, index) => ({
        id: nextId(),
        guildId: f.guildId,
        type: 'guild_text' as const,
        name: `channel-${index}`,
        position: index + 1,
      })),
    );
    const results = await Promise.allSettled([
      service.create(database.db, f.ownerId, f.guildId, { type: 'guild_text', name: 'Last A' }),
      service.create(database.db, f.ownerId, f.guildId, { type: 'guild_text', name: 'Last B' }),
    ]);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.find(({ status }) => status === 'rejected')).toMatchObject({
      reason: { code: 'CONFLICT' },
    });
    expect(
      await database.db
        .select({ id: channels.id })
        .from(channels)
        .where(eq(channels.guildId, f.guildId)),
    ).toHaveLength(500);
  });
});
