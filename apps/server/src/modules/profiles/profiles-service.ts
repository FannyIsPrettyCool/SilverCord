import { has, Permission } from '@silvercord/permissions';
import {
  type CustomStatus,
  type CustomStatusRequest,
  DEFAULT_PROFILE_PRIVACY,
  type GuildMemberProfile,
  type GuildMemberProfilePatch,
  MUTUALS_MAX,
  type OwnProfile,
  type ProfileAudience,
  type ProfileImage,
  type ProfilePatch,
  type ProfilePrivacy,
  type ProfileSection,
  profilePrivacySchema,
  type UserProfile,
  type UserSummary,
} from '@silvercord/protocol';
import { and, eq, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import type { Database } from '../../db/client.ts';
import type { Executor, Transaction } from '../../db/executor.ts';
import { channels as buses, type EventPublisher } from '../../gateway/event-bus.ts';
import { AppError } from '../../http/app-error.ts';
import type { BadgesService } from '../badges/badges-service.ts';
import type { ChannelsService } from '../channels/channels-service.ts';
import type { GuildMembership } from '../guilds/guild-membership.ts';
import type { GuildPermissionsService } from '../guilds/guild-permissions.ts';
import type { MediaService } from '../media/media-service.ts';
import type { PresenceService } from '../presence/presence-service.ts';
import type { RelationshipsService } from '../relationships/relationships-service.ts';
import type { UsersService } from '../users/users-service.ts';
import {
  type GuildMemberProfileRow,
  guildMemberProfiles,
  type UserProfileRow,
  userProfiles,
} from './profiles-schema.ts';

export interface ProfilesDependencies {
  readonly db: Database;
  readonly users: UsersService;
  readonly relationships: RelationshipsService;
  readonly channels: ChannelsService;
  readonly guildMembership: GuildMembership;
  readonly guildPermissions: GuildPermissionsService;
  readonly presence: PresenceService;
  readonly media: MediaService;
  readonly badges: BadgesService;
  readonly events: EventPublisher;
  readonly log: { warn(object: object, message: string): void };
  readonly timings?: { readonly coalesceMs: number; readonly sweepMs: number };
}

/**
 * How close a viewer is to a profile owner. Audiences are thresholds on this scale; a block in
 * either direction drops below every audience.
 */
const BLOCKED = -1;
const STRANGER = 0;
const CO_MEMBER = 1;
const FRIEND = 2;
const SELF = 3;
const AUDIENCE_RANK: Readonly<Record<ProfileAudience, number>> = {
  everyone: STRANGER,
  mutual_guilds: CO_MEMBER,
  friends: FRIEND,
  only_me: SELF,
};
/** Bounds on PROFILE_CHANGED recipients; summaries are refetched on reconnect anyway. */
const FANOUT = { peers: 1_000, coMembers: 5_000 } as const;
const STATUS_MAX_MS = 366 * 24 * 60 * 60 * 1000;

const notFound = () => new AppError('NOT_FOUND', 'User not found');

export function privacyOf(row: Pick<UserProfileRow, 'privacy'> | undefined): ProfilePrivacy {
  // Stored maps are partial and validated on write; unknown keys from older rows are dropped.
  const merged = { ...DEFAULT_PROFILE_PRIVACY, ...(row?.privacy ?? {}) };
  const parsed = profilePrivacySchema.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_PROFILE_PRIVACY;
}

export function sees(closeness: number, privacy: ProfilePrivacy, section: ProfileSection) {
  return closeness >= STRANGER && closeness >= AUDIENCE_RANK[privacy[section]];
}

function customStatusOf(row: UserProfileRow | undefined, now = Date.now()): CustomStatus | null {
  if (!row || (row.customStatusText === null && row.customStatusEmoji === null)) return null;
  if (row.customStatusExpiresAt && row.customStatusExpiresAt.getTime() <= now) return null;
  return {
    text: row.customStatusText,
    emoji: row.customStatusEmoji,
    expiresAt: row.customStatusExpiresAt?.toISOString() ?? null,
  };
}

const themeOf = (row: UserProfileRow | undefined): [number, number] | null =>
  row?.themePrimary != null && row.themeSecondary != null
    ? [row.themePrimary, row.themeSecondary]
    : null;

/** docs/spec/profiles.md */
export function createProfilesService(deps: ProfilesDependencies) {
  const { db, users, relationships, guildMembership, presence, media, events, log } = deps;
  const timings = deps.timings ?? { coalesceMs: 1_000, sweepMs: 60_000 };
  const pending = new Set<bigint>();
  let flushTimer: NodeJS.Timeout | undefined;
  let sweepTimer: NodeJS.Timeout | undefined;
  let closed = false;
  const report = (message: string) => (error: unknown) => log.warn({ err: error }, message);

  async function flush() {
    flushTimer = undefined;
    const subjects = [...pending];
    pending.clear();
    for (const subject of subjects) {
      const [friends, peers, coMembers] = await Promise.all([
        relationships.presenceAudience(db, subject),
        deps.channels.peerIds(db, subject, FANOUT.peers),
        guildMembership.coMemberIds(db, subject, FANOUT.coMembers),
      ]);
      const recipients = new Set([subject, ...friends, ...peers, ...coMembers]);
      const userId = subject.toString();
      await Promise.all(
        [...recipients].map((recipient) =>
          events.dispatch(buses.user(recipient), 'PROFILE_CHANGED', { userId }),
        ),
      );
    }
  }

  /** Queues a content-free PROFILE_CHANGED for everyone who may display `subject`. */
  function invalidate(subject: bigint) {
    if (closed) return;
    pending.add(subject);
    flushTimer ??= setTimeout(
      () => void flush().catch(report('profile publish failed')),
      timings.coalesceMs,
    );
  }

  async function rows(ex: Executor, userIds: readonly bigint[]) {
    if (userIds.length === 0) return new Map<bigint, UserProfileRow>();
    const found = await ex
      .select()
      .from(userProfiles)
      .where(inArray(userProfiles.userId, [...new Set(userIds)]));
    return new Map(found.map((row) => [row.userId, row]));
  }

  /** Creates the default row if needed and locks it for a profile write. */
  async function lockRow(tx: Transaction, userId: bigint): Promise<UserProfileRow> {
    await tx.insert(userProfiles).values({ userId }).onConflictDoNothing();
    const [row] = await tx
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .for('update');
    if (!row) throw notFound();
    return row;
  }

  async function closeness(
    ex: Executor,
    viewerId: bigint,
    ownerIds: readonly bigint[],
  ): Promise<Map<bigint, number>> {
    const others = [...new Set(ownerIds.filter((id) => id !== viewerId))];
    const [blocked, friends, coMembers] = await Promise.all([
      relationships.blockedEitherWay(ex, viewerId, others),
      relationships.friendIdsAmong(ex, viewerId, others),
      guildMembership.coMembersAmong(ex, viewerId, others),
    ]);
    const result = new Map<bigint, number>();
    for (const id of ownerIds) {
      result.set(
        id,
        id === viewerId
          ? SELF
          : blocked.has(id)
            ? BLOCKED
            : friends.has(id)
              ? FRIEND
              : coMembers.has(id)
                ? CO_MEMBER
                : STRANGER,
      );
    }
    return result;
  }

  /** Custom status and activity never reveal someone the viewer sees as offline. */
  async function onlineFor(ex: Executor, viewerId: bigint, ownerIds: readonly bigint[]) {
    const others = ownerIds.filter((id) => id !== viewerId);
    const online = new Set<bigint>(ownerIds.includes(viewerId) ? [viewerId] : []);
    if (others.length === 0) return online;
    const snapshot = await presence.snapshot(ex, viewerId, others);
    for (const item of snapshot.items)
      if (item.status !== 'offline') online.add(BigInt(item.userId));
    return online;
  }

  async function guildRows(ex: Executor, guildId: bigint, userIds: readonly bigint[]) {
    if (userIds.length === 0) return new Map<bigint, GuildMemberProfileRow>();
    const found = await ex
      .select()
      .from(guildMemberProfiles)
      .where(
        and(
          eq(guildMemberProfiles.guildId, guildId),
          inArray(guildMemberProfiles.userId, [...userIds]),
        ),
      );
    return new Map(found.map((row) => [row.userId, row]));
  }

  async function ownView(ex: Executor, userId: bigint): Promise<OwnProfile> {
    const user = await users.findById(ex, userId);
    if (!user) throw notFound();
    const row = (await rows(ex, [userId])).get(userId);
    const images = await media.profileMedia.images(ex, [
      row?.avatarUploadId ?? null,
      row?.bannerUploadId ?? null,
    ]);
    const image = (id: bigint | null | undefined) => (id ? (images.get(id) ?? null) : null);
    return {
      userId: userId.toString(),
      username: user.username,
      displayName: user.displayName,
      bio: row?.bio ?? null,
      pronouns: row?.pronouns ?? null,
      accentColor: row?.accentColor ?? null,
      bannerColor: row?.bannerColor ?? null,
      themeColors: themeOf(row),
      avatar: image(row?.avatarUploadId),
      banner: image(row?.bannerUploadId),
      customStatus: customStatusOf(row),
      privacy: privacyOf(row),
      version: row?.version ?? 1,
      memberSince: user.createdAt.toISOString(),
    };
  }

  /** Swaps one image reference, returning the upload to purge after commit. */
  async function swapImage(
    tx: Transaction,
    input: {
      readonly ownerId: bigint;
      readonly current: bigint | null;
      readonly next: string | null | undefined;
      readonly purpose: 'avatar' | 'banner' | 'guild_avatar' | 'guild_banner';
      readonly guildId: bigint | null;
      readonly field: string;
    },
  ): Promise<{ value: bigint | null; released: bigint[] } | undefined> {
    if (input.next === undefined) return undefined;
    const next = input.next === null ? null : BigInt(input.next);
    if (next === input.current) return { value: next, released: [] };
    if (next !== null)
      await media.profileMedia.claim(tx, {
        ownerId: input.ownerId,
        uploadId: next,
        purpose: input.purpose,
        guildId: input.guildId,
        field: input.field,
      });
    return { value: next, released: await media.profileMedia.release(tx, [input.current]) };
  }

  async function purgeAll(ids: readonly bigint[]) {
    for (const id of ids) await media.purge(id).catch(report('profile media purge failed'));
  }

  // ADR-0011: account images are visible to every signed-in user while they are current;
  // a banner also follows its owner's banner audience.
  media.definePurpose('avatar', {
    async authorizeUpload() {},
    async canView(ex, _viewerId, upload) {
      const row = (await rows(ex, [upload.ownerId])).get(upload.ownerId);
      return row?.avatarUploadId === upload.id;
    },
  });
  media.definePurpose('banner', {
    async authorizeUpload() {},
    async canView(ex, viewerId, upload) {
      const row = (await rows(ex, [upload.ownerId])).get(upload.ownerId);
      if (row?.bannerUploadId !== upload.id) return false;
      const level = (await closeness(ex, viewerId, [upload.ownerId])).get(upload.ownerId);
      return sees(level ?? BLOCKED, privacyOf(row), 'banner');
    },
  });
  for (const purpose of ['guild_avatar', 'guild_banner'] as const) {
    media.definePurpose(purpose, {
      async authorizeUpload(ex, ownerId, guildId) {
        if (guildId === null || !(await guildMembership.isMember(ex, guildId, ownerId)))
          throw new AppError('NOT_FOUND', 'Server not found', { field: 'guildId' });
      },
      async canView(ex, viewerId, upload) {
        if (upload.guildId === null) return false;
        const row = (await guildRows(ex, upload.guildId, [upload.ownerId])).get(upload.ownerId);
        const current = purpose === 'guild_avatar' ? row?.avatarUploadId : row?.bannerUploadId;
        return current === upload.id && guildMembership.isMember(ex, upload.guildId, viewerId);
      },
    });
  }

  return {
    invalidate,
    own: (ex: Executor, userId: bigint) => ownView(ex, userId),

    async patch(userId: bigint, patch: ProfilePatch): Promise<OwnProfile> {
      const released = await db.transaction(async (tx) => {
        const row = await lockRow(tx, userId);
        if (row.version !== patch.version)
          throw new AppError('CONFLICT', 'Profile changed elsewhere', { field: 'version' });
        const avatar = await swapImage(tx, {
          ownerId: userId,
          current: row.avatarUploadId,
          next: patch.avatarUploadId,
          purpose: 'avatar',
          guildId: null,
          field: 'avatarUploadId',
        });
        const banner = await swapImage(tx, {
          ownerId: userId,
          current: row.bannerUploadId,
          next: patch.bannerUploadId,
          purpose: 'banner',
          guildId: null,
          field: 'bannerUploadId',
        });
        const values: Partial<typeof userProfiles.$inferInsert> = {};
        if (patch.bio !== undefined) values.bio = patch.bio || null;
        if (patch.pronouns !== undefined) values.pronouns = patch.pronouns;
        if (patch.accentColor !== undefined) values.accentColor = patch.accentColor;
        if (patch.bannerColor !== undefined) values.bannerColor = patch.bannerColor;
        if (patch.themeColors !== undefined) {
          values.themePrimary = patch.themeColors?.[0] ?? null;
          values.themeSecondary = patch.themeColors?.[1] ?? null;
        }
        if (avatar) values.avatarUploadId = avatar.value;
        if (banner) values.bannerUploadId = banner.value;
        if (patch.displayName !== undefined)
          await users.setDisplayName(tx, userId, patch.displayName);
        await tx
          .update(userProfiles)
          .set({ ...values, version: sql`${userProfiles.version} + 1`, updatedAt: sql`now()` })
          .where(eq(userProfiles.userId, userId));
        return [...(avatar?.released ?? []), ...(banner?.released ?? [])];
      });
      await purgeAll(released);
      invalidate(userId);
      return ownView(db, userId);
    },

    async setPrivacy(userId: bigint, privacy: ProfilePrivacy): Promise<OwnProfile> {
      await db.transaction(async (tx) => {
        await lockRow(tx, userId);
        await tx
          .update(userProfiles)
          .set({ privacy, version: sql`${userProfiles.version} + 1`, updatedAt: sql`now()` })
          .where(eq(userProfiles.userId, userId));
      });
      invalidate(userId);
      return ownView(db, userId);
    },

    async setCustomStatus(userId: bigint, status: CustomStatusRequest | null): Promise<void> {
      const expires = status?.expiresAt ? new Date(status.expiresAt) : null;
      if (
        expires &&
        (expires.getTime() <= Date.now() || expires.getTime() > Date.now() + STATUS_MAX_MS)
      )
        throw new AppError('VALIDATION_FAILED', 'Expiry must be within a year', {
          field: 'expiresAt',
        });
      await db.transaction(async (tx) => {
        await lockRow(tx, userId);
        await tx
          .update(userProfiles)
          .set({
            customStatusText: status?.text || null,
            customStatusEmoji: status?.emoji ?? null,
            customStatusExpiresAt: expires,
            updatedAt: sql`now()`,
          })
          .where(eq(userProfiles.userId, userId));
      });
      invalidate(userId);
    },

    /** One profile as `viewerId` may see it (docs/spec/profiles.md privacy audiences). */
    async view(viewerId: bigint, targetId: bigint, guildId?: bigint): Promise<UserProfile> {
      return db.transaction(async (tx) => {
        const user = await users.findById(tx, targetId);
        if (!user) throw notFound();
        if (guildId !== undefined && !(await guildMembership.isMember(tx, guildId, viewerId)))
          throw new AppError('NOT_FOUND', 'Server not found');
        const member =
          guildId === undefined ? undefined : await guildMembership.member(tx, guildId, targetId);
        const override =
          guildId !== undefined && member
            ? (await guildRows(tx, guildId, [targetId])).get(targetId)
            : undefined;
        const row = (await rows(tx, [targetId])).get(targetId);
        const privacy = privacyOf(row);
        const level = (await closeness(tx, viewerId, [targetId])).get(targetId) ?? BLOCKED;
        const standing = await relationships.standing(tx, viewerId, targetId);
        const avatarId = override?.avatarUploadId ?? row?.avatarUploadId ?? null;
        const bannerId = override?.bannerUploadId ?? row?.bannerUploadId ?? null;
        const images = await media.profileMedia.images(tx, [avatarId, bannerId]);
        const image = (id: bigint | null): ProfileImage | null =>
          id ? (images.get(id) ?? null) : null;
        const profile: UserProfile = {
          userId: targetId.toString(),
          username: user.username,
          displayName: user.displayName,
          avatar: image(avatarId),
          accentColor: override?.accentColor ?? row?.accentColor ?? null,
          bannerColor: row?.bannerColor ?? null,
          themeColors: themeOf(row),
          relationship: standing.kind,
          note: standing.note,
        };
        if (sees(level, privacy, 'banner')) profile.banner = image(bannerId);
        if (sees(level, privacy, 'bio')) profile.bio = override?.bio ?? row?.bio ?? null;
        if (sees(level, privacy, 'pronouns'))
          profile.pronouns = override?.pronouns ?? row?.pronouns ?? null;
        if (sees(level, privacy, 'memberSince')) profile.memberSince = user.createdAt.toISOString();
        if (sees(level, privacy, 'badges'))
          profile.badges = await deps.badges.forProfile(tx, targetId);
        if (
          sees(level, privacy, 'customStatus') &&
          (await onlineFor(tx, viewerId, [targetId])).has(targetId)
        )
          profile.customStatus = customStatusOf(row);
        if (level !== SELF && sees(level, privacy, 'mutualFriends')) {
          const [mine, theirs] = await Promise.all([
            relationships.presenceAudience(tx, viewerId),
            relationships.presenceAudience(tx, targetId),
          ]);
          const theirSet = new Set(theirs);
          const ids = mine.filter((id) => theirSet.has(id) && id !== targetId);
          profile.mutualFriends = {
            count: ids.length,
            ids: ids.slice(0, MUTUALS_MAX).map(String),
          };
        }
        if (level !== SELF && sees(level, privacy, 'mutualGuilds')) {
          const shared = await guildMembership.shared(tx, viewerId, targetId, MUTUALS_MAX);
          profile.mutualGuilds = { count: shared.count, ids: shared.ids.map(String) };
        }
        if (guildId !== undefined && member)
          profile.guildMember = {
            guildId: guildId.toString(),
            nickname: member.nickname,
            joinedAt: member.joinedAt.toISOString(),
            roleIds: member.roleIds.map(String),
          };
        return profile;
      });
    },

    /** Card data for up to 100 users; guild context needs the viewer's membership. */
    async summaries(
      viewerId: bigint,
      userIds: readonly bigint[],
      guildId?: bigint,
    ): Promise<UserSummary[]> {
      return db.transaction(async (tx) => {
        if (guildId !== undefined && !(await guildMembership.isMember(tx, guildId, viewerId)))
          throw new AppError('NOT_FOUND', 'Server not found');
        const existing = new Set(
          (await users.findPublicByIds(tx, userIds)).map((user) => BigInt(user.id)),
        );
        const ids = userIds.filter((id) => existing.has(id));
        const [profileRows, levels, online] = await Promise.all([
          rows(tx, ids),
          closeness(tx, viewerId, ids),
          onlineFor(tx, viewerId, ids),
        ]);
        const nicknames =
          guildId === undefined ? undefined : await guildMembership.nicknames(tx, guildId, ids);
        const overrides =
          guildId === undefined || !nicknames
            ? new Map<bigint, GuildMemberProfileRow>()
            : await guildRows(tx, guildId, [...nicknames.keys()]);
        const avatarOf = (id: bigint) =>
          overrides.get(id)?.avatarUploadId ?? profileRows.get(id)?.avatarUploadId ?? null;
        const images = await media.profileMedia.images(tx, ids.map(avatarOf));
        return ids.map((id) => {
          const row = profileRows.get(id);
          const avatarId = avatarOf(id);
          const summary: UserSummary = {
            userId: id.toString(),
            avatar: avatarId ? (images.get(avatarId) ?? null) : null,
            accentColor: overrides.get(id)?.accentColor ?? row?.accentColor ?? null,
          };
          if (nicknames?.has(id)) summary.nickname = nicknames.get(id) ?? null;
          if (sees(levels.get(id) ?? BLOCKED, privacyOf(row), 'customStatus') && online.has(id))
            summary.customStatus = customStatusOf(row);
          return summary;
        });
      });
    },

    async guildProfile(userId: bigint, guildId: bigint): Promise<GuildMemberProfile> {
      const member = await guildMembership.member(db, guildId, userId);
      if (!member) throw new AppError('NOT_FOUND', 'Server not found');
      const row = (await guildRows(db, guildId, [userId])).get(userId);
      const images = await media.profileMedia.images(db, [
        row?.avatarUploadId ?? null,
        row?.bannerUploadId ?? null,
      ]);
      const image = (id: bigint | null | undefined) => (id ? (images.get(id) ?? null) : null);
      return {
        guildId: guildId.toString(),
        nickname: member.nickname,
        avatar: image(row?.avatarUploadId),
        banner: image(row?.bannerUploadId),
        bio: row?.bio ?? null,
        pronouns: row?.pronouns ?? null,
        accentColor: row?.accentColor ?? null,
      };
    },

    async patchGuildProfile(
      userId: bigint,
      guildId: bigint,
      patch: GuildMemberProfilePatch,
    ): Promise<GuildMemberProfile> {
      const released = await db.transaction(async (tx) => {
        const access = await deps.guildPermissions.guild(tx, guildId, userId);
        if (!access.visible) throw new AppError('NOT_FOUND', 'Server not found');
        if (patch.nickname !== undefined) {
          if (!has(access.permissions, Permission.CHANGE_NICKNAME))
            throw new AppError('FORBIDDEN', 'Missing permission', { field: 'nickname' });
          await guildMembership.setNickname(tx, guildId, userId, patch.nickname);
        }
        await tx.insert(guildMemberProfiles).values({ guildId, userId }).onConflictDoNothing();
        const [row] = await tx
          .select()
          .from(guildMemberProfiles)
          .where(
            and(eq(guildMemberProfiles.guildId, guildId), eq(guildMemberProfiles.userId, userId)),
          )
          .for('update');
        if (!row) throw new AppError('NOT_FOUND', 'Server not found');
        const avatar = await swapImage(tx, {
          ownerId: userId,
          current: row.avatarUploadId,
          next: patch.avatarUploadId,
          purpose: 'guild_avatar',
          guildId,
          field: 'avatarUploadId',
        });
        const banner = await swapImage(tx, {
          ownerId: userId,
          current: row.bannerUploadId,
          next: patch.bannerUploadId,
          purpose: 'guild_banner',
          guildId,
          field: 'bannerUploadId',
        });
        const values: Partial<typeof guildMemberProfiles.$inferInsert> = {};
        if (patch.bio !== undefined) values.bio = patch.bio || null;
        if (patch.pronouns !== undefined) values.pronouns = patch.pronouns;
        if (patch.accentColor !== undefined) values.accentColor = patch.accentColor;
        if (avatar) values.avatarUploadId = avatar.value;
        if (banner) values.bannerUploadId = banner.value;
        await tx
          .update(guildMemberProfiles)
          .set({ ...values, updatedAt: sql`now()` })
          .where(
            and(eq(guildMemberProfiles.guildId, guildId), eq(guildMemberProfiles.userId, userId)),
          );
        return [...(avatar?.released ?? []), ...(banner?.released ?? [])];
      });
      await purgeAll(released);
      invalidate(userId);
      return this.guildProfile(userId, guildId);
    },

    /**
     * The member is leaving `guildId`: release per-server images in this transaction (the row
     * cascades with the membership) and purge them after commit.
     */
    async memberLeaving(tx: Transaction, guildId: bigint, userId: bigint) {
      const row = (await guildRows(tx, guildId, [userId])).get(userId);
      const released = await media.profileMedia.release(tx, [
        row?.avatarUploadId ?? null,
        row?.bannerUploadId ?? null,
      ]);
      return async () => {
        await purgeAll(released);
        invalidate(userId);
      };
    },

    /** Clears expired custom statuses so viewers drop them. */
    async sweepExpired(): Promise<number> {
      const cleared = await db
        .update(userProfiles)
        .set({ customStatusText: null, customStatusEmoji: null, customStatusExpiresAt: null })
        .where(
          and(
            isNotNull(userProfiles.customStatusExpiresAt),
            lte(userProfiles.customStatusExpiresAt, sql`now()`),
          ),
        )
        .returning({ userId: userProfiles.userId });
      for (const { userId } of cleared) invalidate(userId);
      return cleared.length;
    },

    start() {
      if (sweepTimer || closed) return;
      sweepTimer = setInterval(
        () => void this.sweepExpired().catch(report('custom status sweep failed')),
        timings.sweepMs,
      );
      sweepTimer.unref();
    },

    async close() {
      closed = true;
      clearInterval(sweepTimer);
      if (flushTimer) {
        clearTimeout(flushTimer);
        await flush().catch(report('profile publish failed'));
      }
    },
  };
}
export type ProfilesService = ReturnType<typeof createProfilesService>;
