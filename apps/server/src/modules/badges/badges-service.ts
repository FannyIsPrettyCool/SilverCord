import {
  BADGE_DEFINITIONS_MAX,
  BADGE_RARITIES,
  type BadgeAward,
  type BadgeDefinition,
  type BadgePatch,
  type BadgeRarity,
  type BuiltinBadge,
  builtinBadgeSchema,
  type CreateBadgeRequest,
  type ProfileImage,
} from '@silvercord/protocol';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Database } from '../../db/client.ts';
import type { Executor, Transaction } from '../../db/executor.ts';
import { AppError } from '../../http/app-error.ts';
import type { AuthFacts } from '../auth/auth-facts.ts';
import type { GuildMembership } from '../guilds/guild-membership.ts';
import type { MediaService } from '../media/media-service.ts';
import type { UsersService } from '../users/users-service.ts';
import {
  type BadgeDefinitionRow,
  badgeDefinitions,
  type UserBadgeRow,
  userBadges,
} from './badges-schema.ts';

export interface BadgesDependencies {
  readonly db: Database;
  readonly nextId: () => bigint;
  readonly users: UsersService;
  readonly guildMembership: GuildMembership;
  readonly authFacts: AuthFacts;
  readonly media: MediaService;
  /** A holder's badges changed (PROFILE_CHANGED); resolved at call time. */
  readonly changed: (userId: bigint) => void;
  readonly log: {
    info(object: object, message: string): void;
    warn(object: object, message: string): void;
  };
  readonly ruleTtlMs?: number;
}

interface Builtin {
  readonly key: BuiltinBadge;
  readonly rarity: BadgeRarity;
  readonly icon: string;
  /** Permanent rules keep the award once earned; conditional ones revoke. */
  readonly permanent: boolean;
}

const BUILTINS: readonly Builtin[] = [
  { key: 'founder', rarity: 'mythic', icon: 'planet', permanent: true },
  { key: 'early_member', rarity: 'legendary', icon: 'sparkle', permanent: true },
  { key: 'anniversary', rarity: 'rare', icon: 'cake', permanent: true },
  { key: 'instance_admin', rarity: 'epic', icon: 'shield-check', permanent: false },
  { key: 'server_owner', rarity: 'uncommon', icon: 'crown', permanent: false },
  { key: 'verified', rarity: 'common', icon: 'seal-check', permanent: false },
  { key: 'secured', rarity: 'uncommon', icon: 'lock-key', permanent: false },
];
const EARLY_MEMBERS = 100;
const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;
const RARITY_RANK = new Map(BADGE_RARITIES.map((rarity, index) => [rarity, index]));
const notFound = () => new AppError('NOT_FOUND', 'Badge not found');

/** Pinned first (by slot), then rarest, then newest. */
export function badgeOrder(a: BadgeAward, b: BadgeAward): number {
  if (a.pin !== null || b.pin !== null) return (a.pin ?? 99) - (b.pin ?? 99);
  const rarity = (RARITY_RANK.get(b.badge.rarity) ?? 0) - (RARITY_RANK.get(a.badge.rarity) ?? 0);
  return rarity !== 0 ? rarity : b.awardedAt.localeCompare(a.awardedAt);
}

/** docs/spec/badges.md */
export function createBadgesService(deps: BadgesDependencies) {
  const { db, users, guildMembership, authFacts, media, log } = deps;
  const ruleTtlMs = deps.ruleTtlMs ?? 10 * 60_000;
  const evaluatedAt = new Map<bigint, number>();
  let builtinsReady: Promise<void> | undefined;

  /** Built-in definitions exist once per instance, found by key. */
  function ensureBuiltins(): Promise<void> {
    builtinsReady ??= (async () => {
      for (const builtin of BUILTINS)
        await db
          .insert(badgeDefinitions)
          .values({
            id: deps.nextId(),
            key: builtin.key,
            name: builtin.key,
            rarity: builtin.rarity,
            iconName: builtin.icon,
            rule: { type: builtin.key },
          })
          .onConflictDoNothing({ target: badgeDefinitions.key });
    })().catch((error: unknown) => {
      builtinsReady = undefined;
      throw error;
    });
    return builtinsReady;
  }

  async function definitionView(
    rows: readonly BadgeDefinitionRow[],
    ex: Executor,
  ): Promise<Map<bigint, BadgeDefinition>> {
    const images = await media.profileMedia.images(
      ex,
      rows.map((row) => row.iconUploadId),
    );
    const map = new Map<bigint, BadgeDefinition>();
    for (const row of rows) {
      const image: ProfileImage | undefined = row.iconUploadId
        ? images.get(row.iconUploadId)
        : undefined;
      const key = builtinBadgeSchema.safeParse(row.key);
      map.set(row.id, {
        id: row.id.toString(),
        key: key.success ? key.data : null,
        name: row.name,
        description: row.description,
        rarity: row.rarity,
        icon: image
          ? { kind: 'image', image }
          : { kind: 'icon', name: (row.iconName as 'star' | null) ?? 'star' },
        retired: row.retired,
        visual: row.visual,
      });
    }
    return map;
  }

  /** Whether each built-in rule currently holds for `userId`, with its level. */
  async function ruleState(ex: Executor, userId: bigint) {
    const user = await users.findById(ex, userId);
    if (!user) return new Map<BuiltinBadge, number>();
    const rank = await users.rankOf(ex, userId);
    const years = Math.floor((Date.now() - user.createdAt.getTime()) / YEAR_MS);
    const holds = new Map<BuiltinBadge, number>();
    if (rank === 0) holds.set('founder', 1);
    if (rank < EARLY_MEMBERS) holds.set('early_member', 1);
    if (years >= 1) holds.set('anniversary', years);
    if (user.isInstanceAdmin) holds.set('instance_admin', 1);
    if (await guildMembership.ownsGuild(ex, userId)) holds.set('server_owner', 1);
    if (user.emailVerifiedAt) holds.set('verified', 1);
    if (await authFacts.mfaEnabled(ex, userId)) holds.set('secured', 1);
    return holds;
  }

  /** Brings rule awards in line with the rules; returns whether anything changed. */
  async function evaluate(userId: bigint, force = false): Promise<void> {
    const last = evaluatedAt.get(userId);
    if (!force && last !== undefined && Date.now() - last < ruleTtlMs) return;
    await ensureBuiltins();
    const changed = await db.transaction(async (tx) => {
      const holds = await ruleState(tx, userId);
      const definitions = await tx
        .select()
        .from(badgeDefinitions)
        .where(inArray(badgeDefinitions.key, [...BUILTINS.map((builtin) => builtin.key)]));
      const held = new Map(
        (
          await tx
            .select()
            .from(userBadges)
            .where(
              and(
                eq(userBadges.userId, userId),
                inArray(
                  userBadges.badgeId,
                  definitions.map((definition) => definition.id),
                ),
              ),
            )
        ).map((row) => [row.badgeId, row]),
      );
      let dirty = false;
      for (const definition of definitions) {
        const builtin = BUILTINS.find((candidate) => candidate.key === definition.key);
        if (!builtin) continue;
        const level = holds.get(builtin.key);
        const current = held.get(definition.id);
        if (level !== undefined && !current) {
          await tx
            .insert(userBadges)
            .values({ userId, badgeId: definition.id, level })
            .onConflictDoNothing();
          dirty = true;
        } else if (level !== undefined && current && level > current.level) {
          await tx
            .update(userBadges)
            .set({ level })
            .where(and(eq(userBadges.userId, userId), eq(userBadges.badgeId, definition.id)));
          dirty = true;
        } else if (level === undefined && current && !builtin.permanent && !current.awardedBy) {
          await tx
            .delete(userBadges)
            .where(and(eq(userBadges.userId, userId), eq(userBadges.badgeId, definition.id)));
          dirty = true;
        }
      }
      return dirty;
    });
    evaluatedAt.set(userId, Date.now());
    if (evaluatedAt.size > 10_000) {
      const [oldest] = evaluatedAt.keys();
      if (oldest !== undefined) evaluatedAt.delete(oldest);
    }
    if (changed) deps.changed(userId);
  }

  async function awards(ex: Executor, userId: bigint): Promise<BadgeAward[]> {
    const rows = await ex
      .select({ award: userBadges, definition: badgeDefinitions })
      .from(userBadges)
      .innerJoin(badgeDefinitions, eq(badgeDefinitions.id, userBadges.badgeId))
      .where(eq(userBadges.userId, userId));
    const views = await definitionView(
      rows.map((row) => row.definition),
      ex,
    );
    return rows
      .flatMap(({ award, definition }) => {
        const badge = views.get(definition.id);
        return badge ? [toAward(award, badge)] : [];
      })
      .sort(badgeOrder);
  }

  function toAward(row: UserBadgeRow, badge: BadgeDefinition): BadgeAward {
    return { badge, level: row.level, awardedAt: row.awardedAt.toISOString(), pin: row.pin };
  }

  async function requireManual(tx: Transaction, badgeId: bigint, lock = false) {
    const query = tx.select().from(badgeDefinitions).where(eq(badgeDefinitions.id, badgeId));
    const [row] = await (lock ? query.for('update') : query);
    if (!row) throw notFound();
    if (row.key !== null) throw new AppError('FORBIDDEN', 'Built-in badges follow their rules');
    return row;
  }

  async function claimIcon(tx: Transaction, actorId: bigint, uploadId: string) {
    await media.profileMedia.claim(tx, {
      ownerId: actorId,
      uploadId: BigInt(uploadId),
      purpose: 'badge_icon',
      guildId: null,
      field: 'iconUploadId',
    });
    return BigInt(uploadId);
  }

  media.definePurpose('badge_icon', {
    async authorizeUpload(ex, ownerId) {
      if (!(await users.findById(ex, ownerId))?.isInstanceAdmin)
        throw new AppError('FORBIDDEN', 'Instance administrators only');
    },
    async canView(ex, _viewerId, upload) {
      const [row] = await ex
        .select({ id: badgeDefinitions.id })
        .from(badgeDefinitions)
        .where(eq(badgeDefinitions.iconUploadId, upload.id))
        .limit(1);
      return row !== undefined;
    },
  });

  const report = (message: string) => (error: unknown) => log.warn({ err: error }, message);

  return {
    ensureBuiltins,
    evaluate,

    /** Awards for a profile view; rules are re-evaluated at most every ten minutes. */
    async forProfile(ex: Executor, userId: bigint): Promise<BadgeAward[]> {
      await evaluate(userId).catch(report('badge rules failed'));
      return awards(ex, userId);
    },

    async own(userId: bigint): Promise<BadgeAward[]> {
      await evaluate(userId);
      return awards(db, userId);
    },

    async definitions(viewerId: bigint): Promise<BadgeDefinition[]> {
      await ensureBuiltins();
      const held = db
        .select({ id: userBadges.badgeId })
        .from(userBadges)
        .where(eq(userBadges.userId, viewerId));
      const rows = await db
        .select()
        .from(badgeDefinitions)
        .where(sql`${badgeDefinitions.retired} = false or ${badgeDefinitions.id} in (${held})`)
        .orderBy(asc(badgeDefinitions.id));
      const views = await definitionView(rows, db);
      // Rarest first; text columns would sort rarities alphabetically.
      return rows
        .flatMap((row) => views.get(row.id) ?? [])
        .sort((a, b) => (RARITY_RANK.get(b.rarity) ?? 0) - (RARITY_RANK.get(a.rarity) ?? 0));
    },

    async setPins(userId: bigint, badgeIds: readonly string[]): Promise<BadgeAward[]> {
      await db.transaction(async (tx) => {
        const ids = badgeIds.map(BigInt);
        const owned = await tx
          .select({ badgeId: userBadges.badgeId })
          .from(userBadges)
          .where(eq(userBadges.userId, userId))
          .for('update');
        const ownedIds = new Set(owned.map((row) => row.badgeId));
        if (ids.some((id) => !ownedIds.has(id)))
          throw new AppError('NOT_FOUND', 'Badge not held', { field: 'badgeIds' });
        await tx.update(userBadges).set({ pin: null }).where(eq(userBadges.userId, userId));
        for (const [pin, badgeId] of ids.entries())
          await tx
            .update(userBadges)
            .set({ pin })
            .where(and(eq(userBadges.userId, userId), eq(userBadges.badgeId, badgeId)));
      });
      deps.changed(userId);
      return awards(db, userId);
    },

    async create(actorId: bigint, request: CreateBadgeRequest): Promise<BadgeDefinition> {
      await ensureBuiltins();
      const row = await db.transaction(async (tx) => {
        const [count] = await tx
          .select({ value: sql<number>`count(*)::int` })
          .from(badgeDefinitions);
        if ((count?.value ?? 0) >= BADGE_DEFINITIONS_MAX)
          throw new AppError('CONFLICT', 'Badge limit reached');
        const iconUploadId = request.iconUploadId
          ? await claimIcon(tx, actorId, request.iconUploadId)
          : null;
        const [inserted] = await tx
          .insert(badgeDefinitions)
          .values({
            id: deps.nextId(),
            name: request.name,
            description: request.description,
            rarity: request.rarity,
            visual: request.visual ?? null,
            iconName: request.iconName ?? null,
            iconUploadId,
          })
          .returning();
        if (!inserted) throw new Error('insert returned no row');
        log.info({ actorId: actorId.toString(), badgeId: inserted.id.toString() }, 'badge created');
        return inserted;
      });
      const view = (await definitionView([row], db)).get(row.id);
      if (!view) throw notFound();
      return view;
    },

    async update(actorId: bigint, badgeId: bigint, patch: BadgePatch): Promise<BadgeDefinition> {
      const { row, released } = await db.transaction(async (tx) => {
        const current = await requireManual(tx, badgeId, true);
        const values: Partial<typeof badgeDefinitions.$inferInsert> = {};
        if (patch.name !== undefined) values.name = patch.name;
        if (patch.description !== undefined) values.description = patch.description;
        if (patch.visual !== undefined) values.visual = patch.visual;
        if (patch.rarity !== undefined) values.rarity = patch.rarity;
        if (patch.retired !== undefined) values.retired = patch.retired;
        let released: bigint[] = [];
        if (patch.iconName !== undefined || patch.iconUploadId !== undefined) {
          values.iconName = patch.iconName ?? null;
          values.iconUploadId = patch.iconUploadId
            ? await claimIcon(tx, actorId, patch.iconUploadId)
            : null;
          if (current.iconUploadId !== values.iconUploadId)
            released = await media.profileMedia.release(tx, [current.iconUploadId]);
        }
        const [updated] = await tx
          .update(badgeDefinitions)
          .set(values)
          .where(eq(badgeDefinitions.id, badgeId))
          .returning();
        if (!updated) throw notFound();
        return { row: updated, released };
      });
      for (const id of released) await media.purge(id).catch(report('badge icon purge failed'));
      log.info({ actorId: actorId.toString(), badgeId: badgeId.toString() }, 'badge updated');
      const holders = await db
        .select({ userId: userBadges.userId })
        .from(userBadges)
        .where(eq(userBadges.badgeId, badgeId))
        .limit(5_000);
      for (const holder of holders) deps.changed(holder.userId);
      const view = (await definitionView([row], db)).get(row.id);
      if (!view) throw notFound();
      return view;
    },

    async award(
      actorId: bigint,
      badgeId: bigint,
      username: string,
      reason: string | null,
    ): Promise<BadgeAward> {
      const target = await users.findPublicByUsername(db, username);
      if (!target) throw new AppError('NOT_FOUND', 'User not found', { field: 'username' });
      const userId = BigInt(target.id);
      const row = await db.transaction(async (tx) => {
        const definition = await requireManual(tx, badgeId);
        if (definition.retired) throw new AppError('CONFLICT', 'Badge is retired');
        await tx
          .insert(userBadges)
          .values({ userId, badgeId, awardedBy: actorId, reason })
          .onConflictDoNothing();
        const [award] = await tx
          .select()
          .from(userBadges)
          .where(and(eq(userBadges.userId, userId), eq(userBadges.badgeId, badgeId)));
        if (!award) throw notFound();
        return { award, definition };
      });
      log.info(
        { actorId: actorId.toString(), badgeId: badgeId.toString(), userId: target.id },
        'badge awarded',
      );
      deps.changed(userId);
      const view = (await definitionView([row.definition], db)).get(row.definition.id);
      if (!view) throw notFound();
      return toAward(row.award, view);
    },

    async revoke(actorId: bigint, badgeId: bigint, userId: bigint): Promise<void> {
      await db.transaction(async (tx) => {
        await requireManual(tx, badgeId);
        await tx
          .delete(userBadges)
          .where(and(eq(userBadges.userId, userId), eq(userBadges.badgeId, badgeId)));
      });
      log.info(
        { actorId: actorId.toString(), badgeId: badgeId.toString(), userId: userId.toString() },
        'badge revoked',
      );
      deps.changed(userId);
    },

    /** Rule awards only (no admin grant), for tests and maintenance. */
    async ruleAwards(userId: bigint) {
      return db
        .select()
        .from(userBadges)
        .where(and(eq(userBadges.userId, userId), isNull(userBadges.awardedBy)));
    },
  };
}
export type BadgesService = ReturnType<typeof createBadgesService>;
