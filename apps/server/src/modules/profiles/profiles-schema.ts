import type { ActivityInput, ActivitySources, ProfilePrivacy } from '@silvercord/protocol';
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
} from 'drizzle-orm/pg-core';
import { snowflake, timestamptz } from '../../db/columns.ts';
import { guildMembers } from '../guilds/guilds-schema.ts';
import { mediaUploads } from '../media/media-schema.ts';
import { users } from '../users/users-schema.ts';

const color = (column: unknown) => sql`${column} is null or ${column} between 0 and 16777215`;

/** docs/spec/profiles.md. A missing row means every field is at its default. */
export const userProfiles = pgTable(
  'user_profiles',
  {
    userId: snowflake()
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    bio: text(),
    pronouns: text(),
    accentColor: integer(),
    bannerColor: integer(),
    themePrimary: integer(),
    themeSecondary: integer(),
    avatarUploadId: snowflake().references(() => mediaUploads.id, { onDelete: 'set null' }),
    bannerUploadId: snowflake().references(() => mediaUploads.id, { onDelete: 'set null' }),
    customStatusText: text(),
    customStatusEmoji: text(),
    customStatusExpiresAt: timestamptz(),
    /** Partial audience map; defaults are merged on read. */
    privacy: jsonb().$type<Partial<ProfilePrivacy>>().notNull().default({}),
    /** docs/spec/activity.md: every source is off until turned on. */
    activitySources: jsonb().$type<Partial<ActivitySources>>().notNull().default({}),
    manualActivity: jsonb().$type<ActivityInput>(),
    manualActivityExpiresAt: timestamptz(),
    version: integer().notNull().default(1),
    updatedAt: timestamptz().notNull().default(sql`now()`),
  },
  (table) => [
    check('user_profiles_bio_length', sql`char_length(${table.bio}) <= 400`),
    check('user_profiles_pronouns_length', sql`char_length(${table.pronouns}) between 1 and 40`),
    check('user_profiles_accent_color', color(table.accentColor)),
    check('user_profiles_banner_color', color(table.bannerColor)),
    check('user_profiles_theme_primary', color(table.themePrimary)),
    check('user_profiles_theme_secondary', color(table.themeSecondary)),
    check(
      'user_profiles_theme_pair',
      sql`(${table.themePrimary} is null) = (${table.themeSecondary} is null)`,
    ),
    check('user_profiles_custom_status_length', sql`char_length(${table.customStatusText}) <= 128`),
    check('user_profiles_version_positive', sql`${table.version} > 0`),
    index('user_profiles_activity_expiry_idx')
      .on(table.manualActivityExpiresAt)
      .where(sql`${table.manualActivityExpiresAt} is not null`),
    index('user_profiles_status_expiry_idx')
      .on(table.customStatusExpiresAt)
      .where(sql`${table.customStatusExpiresAt} is not null`),
  ],
);

/** Per-server overrides; a null column inherits the global profile. */
export const guildMemberProfiles = pgTable(
  'guild_member_profiles',
  {
    guildId: snowflake().notNull(),
    userId: snowflake().notNull(),
    avatarUploadId: snowflake().references(() => mediaUploads.id, { onDelete: 'set null' }),
    bannerUploadId: snowflake().references(() => mediaUploads.id, { onDelete: 'set null' }),
    bio: text(),
    pronouns: text(),
    accentColor: integer(),
    updatedAt: timestamptz().notNull().default(sql`now()`),
  },
  (table) => [
    primaryKey({ columns: [table.guildId, table.userId] }),
    foreignKey({
      name: 'guild_member_profiles_member_fk',
      columns: [table.guildId, table.userId],
      foreignColumns: [guildMembers.guildId, guildMembers.userId],
    }).onDelete('cascade'),
    check('guild_member_profiles_bio_length', sql`char_length(${table.bio}) <= 400`),
    check(
      'guild_member_profiles_pronouns_length',
      sql`char_length(${table.pronouns}) between 1 and 40`,
    ),
    check('guild_member_profiles_accent_color', color(table.accentColor)),
    index('guild_member_profiles_user_idx').on(table.userId),
  ],
);

export type UserProfileRow = typeof userProfiles.$inferSelect;
export type GuildMemberProfileRow = typeof guildMemberProfiles.$inferSelect;
