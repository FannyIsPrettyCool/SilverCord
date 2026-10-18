import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  unique,
} from 'drizzle-orm/pg-core';
import { snowflake, timestamptz } from '../../db/columns.ts';
import { users } from '../users/users-schema.ts';

/** docs/spec/guilds.md. The `@everyone` role shares the guild's id. */
export const guilds = pgTable(
  'guilds',
  {
    id: snowflake().primaryKey(),
    name: text().notNull(),
    // RESTRICT: ownership must be transferred before the owner's account can go.
    ownerId: snowflake()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    version: integer().notNull().default(1),
    createdAt: timestamptz().notNull().default(sql`now()`),
  },
  (table) => [
    check('guilds_name_length', sql`char_length(${table.name}) between 1 and 100`),
    check('guilds_version_positive', sql`${table.version} > 0`),
    index('guilds_owner_idx').on(table.ownerId),
  ],
);

export const guildMembers = pgTable(
  'guild_members',
  {
    guildId: snowflake()
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    userId: snowflake()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    nickname: text(),
    joinedAt: timestamptz().notNull().default(sql`now()`),
    timeoutUntil: timestamptz(),
    temporary: boolean().notNull().default(false),
  },
  (table) => [
    primaryKey({ columns: [table.guildId, table.userId] }),
    check(
      'guild_members_nickname_length',
      sql`${table.nickname} is null or char_length(${table.nickname}) between 1 and 32`,
    ),
    index('guild_members_user_idx').on(table.userId),
  ],
);

export const roles = pgTable(
  'roles',
  {
    id: snowflake().primaryKey(),
    guildId: snowflake()
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    color: integer(),
    icon: text(),
    permissions: bigint({ mode: 'bigint' }).notNull(),
    // Unique per guild through a DEFERRABLE constraint in the migration, so reorders can swap.
    position: integer().notNull(),
    hoist: boolean().notNull().default(false),
    mentionable: boolean().notNull().default(false),
    createdAt: timestamptz().notNull().default(sql`now()`),
  },
  (table) => [
    check('roles_name_length', sql`char_length(${table.name}) between 1 and 100`),
    check(
      'roles_color_range',
      sql`${table.color} is null or ${table.color} between 0 and 16777215`,
    ),
    check('roles_position_nonnegative', sql`${table.position} >= 0`),
    check('roles_permissions_nonnegative', sql`${table.permissions} >= 0`),
    check(
      'roles_everyone_position',
      sql`(${table.position} = 0) = (${table.id} = ${table.guildId})`,
    ),
    check(
      'roles_icon_length',
      sql`${table.icon} is null or octet_length(${table.icon}) between 1 and 64`,
    ),
    index('roles_guild_idx').on(table.guildId),
    unique('roles_guild_id_unique').on(table.guildId, table.id),
    unique('roles_guild_position_unique').on(table.guildId, table.position),
  ],
);

export const memberRoles = pgTable(
  'member_roles',
  {
    guildId: snowflake().notNull(),
    userId: snowflake().notNull(),
    roleId: snowflake().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.guildId, table.userId, table.roleId] }),
    foreignKey({
      name: 'member_roles_guild_role_fk',
      columns: [table.guildId, table.roleId],
      foreignColumns: [roles.guildId, roles.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'member_roles_member_fk',
      columns: [table.guildId, table.userId],
      foreignColumns: [guildMembers.guildId, guildMembers.userId],
    }).onDelete('cascade'),
    index('member_roles_role_idx').on(table.roleId),
  ],
);

export const guildBans = pgTable(
  'guild_bans',
  {
    guildId: snowflake()
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    userId: snowflake()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    reason: text(),
    bannedBy: snowflake().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamptz().notNull().default(sql`now()`),
  },
  (table) => [
    primaryKey({ columns: [table.guildId, table.userId] }),
    check(
      'guild_bans_reason_length',
      sql`${table.reason} is null or char_length(${table.reason}) <= 512`,
    ),
    index('guild_bans_user_idx').on(table.userId),
    index('guild_bans_banned_by_idx').on(table.bannedBy),
  ],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: snowflake().primaryKey(),
    guildId: snowflake()
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    actorId: snowflake().references(() => users.id, { onDelete: 'set null' }),
    action: text().notNull(),
    targetType: text(),
    targetId: snowflake(),
    changes: jsonb().$type<Record<string, unknown>>(),
    reason: text(),
    createdAt: timestamptz().notNull().default(sql`now()`),
  },
  (table) => [
    check(
      'audit_log_reason_length',
      sql`${table.reason} is null or char_length(${table.reason}) <= 512`,
    ),
    index('audit_log_guild_idx').on(table.guildId, table.id.desc()),
    index('audit_log_actor_idx').on(table.actorId),
  ],
);

export type GuildRow = typeof guilds.$inferSelect;
export type RoleRow = typeof roles.$inferSelect;
export type GuildMemberRow = typeof guildMembers.$inferSelect;
