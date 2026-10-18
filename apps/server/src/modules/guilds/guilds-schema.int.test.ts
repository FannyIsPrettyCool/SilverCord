import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase } from '../../../test/database.ts';
import { users } from '../users/users-schema.ts';
import { auditLog, guildBans, guildMembers, guilds, memberRoles, roles } from './guilds-schema.ts';

describe('guild foundation migration and constraints', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let sequence = 1_000n;
  const nextId = () => sequence++;
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(() => database.close());

  async function user() {
    const id = nextId();
    await database.db.insert(users).values({
      id,
      username: `guilduser${id}`,
      email: `guilduser${id}@example.test`,
      passwordHash: 'not-used-by-schema-tests',
      locale: 'en',
      ageConfirmedAt: new Date(),
    });
    return id;
  }

  async function fixture() {
    const ownerId = await user();
    const memberId = await user();
    const guildId = nextId();
    const roleId = nextId();
    await database.db.transaction(async (tx) => {
      await tx.insert(guilds).values({ id: guildId, ownerId, name: 'Test guild' });
      await tx.insert(guildMembers).values([
        { guildId, userId: ownerId },
        { guildId, userId: memberId },
      ]);
      await tx.insert(roles).values([
        { id: guildId, guildId, name: '@everyone', permissions: 1n, position: 0 },
        { id: roleId, guildId, name: 'Moderator', permissions: 1n << 32n, position: 1 },
      ]);
    });
    return { guildId, ownerId, memberId, roleId };
  }

  const rejectedConstraint = (operation: Promise<unknown>, name: string, code: string) =>
    expect(operation).rejects.toMatchObject({ cause: { code, constraint_name: name } });

  it('rejects cross-guild roles and assignments to nonmembers', async () => {
    const a = await fixture();
    const b = await fixture();
    await rejectedConstraint(
      database.db.insert(memberRoles).values({
        guildId: a.guildId,
        userId: a.memberId,
        roleId: b.roleId,
      }),
      'member_roles_guild_role_fk',
      '23503',
    );
    await rejectedConstraint(
      database.db.insert(memberRoles).values({
        guildId: a.guildId,
        userId: b.memberId,
        roleId: a.roleId,
      }),
      'member_roles_member_fk',
      '23503',
    );
    await database.db.insert(memberRoles).values({
      guildId: a.guildId,
      userId: a.memberId,
      roleId: a.roleId,
    });
  });

  it('rejects duplicate role positions immediately and swaps positions when deferred', async () => {
    const f = await fixture();
    const second = nextId();
    await rejectedConstraint(
      database.db.insert(roles).values({
        id: second,
        guildId: f.guildId,
        name: 'Duplicate',
        permissions: 0n,
        position: 1,
      }),
      'roles_guild_position_unique',
      '23505',
    );
    await database.db.insert(roles).values({
      id: second,
      guildId: f.guildId,
      name: 'Second',
      permissions: 0n,
      position: 2,
    });
    await database.db.transaction(async (tx) => {
      await tx.execute(sql`SET CONSTRAINTS roles_guild_position_unique DEFERRED`);
      await tx.update(roles).set({ position: 2 }).where(eq(roles.id, f.roleId));
      await tx.update(roles).set({ position: 1 }).where(eq(roles.id, second));
    });
    const rows = await database.db.select().from(roles).where(eq(roles.guildId, f.guildId));
    expect(rows.find((role) => role.id === f.roleId)?.position).toBe(2);
    expect(rows.find((role) => role.id === second)?.position).toBe(1);
    expect(rows.find((role) => role.id === f.roleId)?.permissions).toBe(1n << 32n);
  });

  it('does not let deferred duplicates survive commit', async () => {
    const f = await fixture();
    await expect(
      database.db.transaction(async (tx) => {
        await tx.execute(sql`SET CONSTRAINTS roles_guild_position_unique DEFERRED`);
        await tx.insert(roles).values({
          id: nextId(),
          guildId: f.guildId,
          name: 'Duplicate',
          permissions: 0n,
          position: 1,
        });
      }),
    ).rejects.toMatchObject({ code: '23505', constraint_name: 'roles_guild_position_unique' });
    expect(await database.db.select().from(roles).where(eq(roles.guildId, f.guildId))).toHaveLength(
      2,
    );
  });

  it('reserves position zero for everyone and rejects negative permission masks', async () => {
    const f = await fixture();
    await rejectedConstraint(
      database.db.update(roles).set({ position: 2 }).where(eq(roles.id, f.guildId)),
      'roles_everyone_position',
      '23514',
    );
    await rejectedConstraint(
      database.db.update(roles).set({ position: 0 }).where(eq(roles.id, f.roleId)),
      'roles_everyone_position',
      '23514',
    );
    await rejectedConstraint(
      database.db.update(roles).set({ permissions: -1n }).where(eq(roles.id, f.roleId)),
      'roles_permissions_nonnegative',
      '23514',
    );
  });

  it('restricts owner deletion until transfer and preserves audit rows after account deletion', async () => {
    const f = await fixture();
    const bannedId = await user();
    const auditId = nextId();
    await database.db.insert(guildBans).values({
      guildId: f.guildId,
      userId: bannedId,
      bannedBy: f.ownerId,
      reason: 'Example',
    });
    await database.db.insert(auditLog).values({
      id: auditId,
      guildId: f.guildId,
      actorId: f.ownerId,
      action: 'MEMBER_BAN',
      targetType: 'user',
      targetId: bannedId,
      changes: { banned: true },
    });
    await rejectedConstraint(
      database.db.delete(users).where(eq(users.id, f.ownerId)),
      'guilds_owner_id_users_id_fk',
      '23001',
    );
    await database.db.update(guilds).set({ ownerId: f.memberId }).where(eq(guilds.id, f.guildId));
    await database.db.delete(users).where(eq(users.id, f.ownerId));
    const [audit] = await database.db.select().from(auditLog).where(eq(auditLog.id, auditId));
    expect(audit).toMatchObject({ actorId: null, targetId: bannedId, changes: { banned: true } });
    const [ban] = await database.db
      .select()
      .from(guildBans)
      .where(eq(guildBans.guildId, f.guildId));
    expect(ban?.bannedBy).toBeNull();
    expect(
      await database.db.select().from(guildMembers).where(eq(guildMembers.userId, f.ownerId)),
    ).toEqual([]);
  });

  it('cascades role/member assignments and all guild-owned rows without touching another guild', async () => {
    const f = await fixture();
    const other = await fixture();
    const extraRoleId = nextId();
    await database.db.insert(roles).values({
      id: extraRoleId,
      guildId: f.guildId,
      name: 'Extra',
      permissions: 0n,
      position: 2,
    });
    await database.db.insert(memberRoles).values([
      { guildId: f.guildId, userId: f.ownerId, roleId: extraRoleId },
      { guildId: f.guildId, userId: f.memberId, roleId: f.roleId },
    ]);
    await database.db.delete(roles).where(eq(roles.id, extraRoleId));
    expect(
      await database.db.select().from(memberRoles).where(eq(memberRoles.userId, f.ownerId)),
    ).toEqual([]);
    await database.db.delete(guildMembers).where(eq(guildMembers.userId, f.memberId));
    expect(
      await database.db.select().from(memberRoles).where(eq(memberRoles.userId, f.memberId)),
    ).toEqual([]);
    await database.db.insert(guildBans).values({ guildId: f.guildId, userId: f.memberId });
    await database.db
      .insert(auditLog)
      .values({ id: nextId(), guildId: f.guildId, action: 'ROLE_DELETE' });
    await database.db.delete(guilds).where(eq(guilds.id, f.guildId));
    for (const table of [roles, guildMembers, memberRoles, guildBans, auditLog]) {
      expect(await database.db.select().from(table).where(eq(table.guildId, f.guildId))).toEqual(
        [],
      );
    }
    expect(
      await database.db.select().from(guilds).where(eq(guilds.id, other.guildId)),
    ).toHaveLength(1);
    expect(await database.db.select().from(users).where(eq(users.id, f.ownerId))).toHaveLength(1);
  });
});
