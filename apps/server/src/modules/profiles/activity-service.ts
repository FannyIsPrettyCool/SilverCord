import {
  ACTIVITY_SOURCES,
  ACTIVITY_STALE_MS,
  type Activity,
  type ActivityInput,
  type ActivitySource,
  type ActivitySources,
  activityInputSchema,
  activitySourcesSchema,
  DEFAULT_ACTIVITY_SOURCES,
  type DetectedSource,
  type OwnActivity,
} from '@silvercord/protocol';
import { and, eq, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import type { Database } from '../../db/client.ts';
import type { Executor } from '../../db/executor.ts';
import { AppError } from '../../http/app-error.ts';
import type { Valkey } from '../../infra/valkey.ts';
import { type UserProfileRow, userProfiles } from './profiles-schema.ts';

export interface ActivityDependencies {
  readonly db: Database;
  readonly valkey: Valkey;
  /** The user's visible activity changed (PROFILE_CHANGED); resolved at call time. */
  readonly changed: (userId: bigint) => void;
  readonly log: { warn(object: object, message: string): void };
}

/** Primary first: what an app says beats what was detected beats what was typed. */
const PRIORITY: readonly ActivitySource[] = ['rpc', 'game', 'media', 'manual'];
/** The whole hash expires once no device has refreshed it for a while. */
const KEY_TTL_SECONDS = 300;
const key = (userId: bigint) => `activity:${userId}`;

interface StoredEntry {
  readonly a: ActivityInput;
  readonly at: number;
}

export function sourcesOf(row: Pick<UserProfileRow, 'activitySources'> | undefined) {
  const parsed = activitySourcesSchema.safeParse({
    ...DEFAULT_ACTIVITY_SOURCES,
    ...(row?.activitySources ?? {}),
  });
  return parsed.success ? parsed.data : DEFAULT_ACTIVITY_SOURCES;
}

export function toActivity(source: ActivitySource, input: ActivityInput): Activity {
  return {
    source,
    type: input.type,
    name: input.name,
    details: input.details ?? null,
    state: input.state ?? null,
    startedAt: input.startedAt ?? null,
    endsAt: input.endsAt ?? null,
    // Links are an RPC feature; other sources never carry them.
    buttons: source === 'rpc' ? (input.buttons ?? []) : [],
    application: source === 'rpc' ? (input.application ?? null) : null,
  };
}

/** Newest fresh entry per detected source from one user's hash; stale fields are reported. */
export function pickDetected(
  hash: Record<string, string>,
  now: number,
): { readonly entries: Map<DetectedSource, ActivityInput>; readonly stale: string[] } {
  const newest = new Map<DetectedSource, StoredEntry>();
  const stale: string[] = [];
  for (const [field, raw] of Object.entries(hash)) {
    const source = field.split(':')[0];
    if (source !== 'game' && source !== 'rpc' && source !== 'media') {
      stale.push(field);
      continue;
    }
    let entry: StoredEntry;
    try {
      entry = JSON.parse(raw) as StoredEntry;
    } catch {
      stale.push(field);
      continue;
    }
    const valid = activityInputSchema.safeParse(entry.a);
    if (!valid.success || typeof entry.at !== 'number' || now - entry.at > ACTIVITY_STALE_MS) {
      stale.push(field);
      continue;
    }
    const current = newest.get(source);
    if (!current || entry.at > current.at) newest.set(source, { a: valid.data, at: entry.at });
  }
  return { entries: new Map([...newest].map(([source, entry]) => [source, entry.a])), stale };
}

/** docs/spec/activity.md */
export function createActivityService(deps: ActivityDependencies) {
  const { db, valkey, log } = deps;
  const report = (message: string) => (error: unknown) => log.warn({ err: error }, message);

  async function profileRows(ex: Executor, userIds: readonly bigint[]) {
    if (userIds.length === 0) return new Map<bigint, UserProfileRow>();
    const rows = await ex
      .select()
      .from(userProfiles)
      .where(inArray(userProfiles.userId, [...new Set(userIds)]));
    return new Map(rows.map((row) => [row.userId, row]));
  }

  async function ensureRow(userId: bigint) {
    await db.insert(userProfiles).values({ userId }).onConflictDoNothing();
  }

  async function sourcesFor(userId: bigint): Promise<ActivitySources> {
    return sourcesOf((await profileRows(db, [userId])).get(userId));
  }

  async function detected(userIds: readonly bigint[]) {
    const result = new Map<bigint, Map<DetectedSource, ActivityInput>>();
    if (userIds.length === 0) return result;
    try {
      const pipeline = valkey.pipeline();
      for (const id of userIds) pipeline.hgetall(key(id));
      const replies = (await pipeline.exec()) ?? [];
      const now = Date.now();
      const cleanup = valkey.pipeline();
      let dirty = false;
      userIds.forEach((id, index) => {
        const [error, hash] = replies[index] ?? [];
        if (error || !hash) return;
        const { entries, stale } = pickDetected(hash as Record<string, string>, now);
        result.set(id, entries);
        if (stale.length) {
          cleanup.hdel(key(id), ...stale);
          dirty = true;
        }
      });
      if (dirty) await cleanup.exec();
    } catch (error) {
      // A Valkey outage hides detected activity; it never fails a profile read.
      report('activity read degraded')(error);
    }
    return result;
  }

  /** Visible activities per user, primary first, honouring each user's source switches. */
  async function activitiesOf(
    ex: Executor,
    userIds: readonly bigint[],
  ): Promise<Map<bigint, Activity[]>> {
    const [rows, live] = await Promise.all([profileRows(ex, userIds), detected(userIds)]);
    const now = Date.now();
    const map = new Map<bigint, Activity[]>();
    for (const id of userIds) {
      const row = rows.get(id);
      const sources = sourcesOf(row);
      const found = new Map<ActivitySource, Activity>();
      for (const [source, input] of live.get(id) ?? [])
        if (sources[source]) found.set(source, toActivity(source, input));
      const manual = row?.manualActivity;
      const expired = row?.manualActivityExpiresAt && row.manualActivityExpiresAt.getTime() <= now;
      if (sources.manual && manual && !expired) {
        const valid = activityInputSchema.safeParse(manual);
        if (valid.success) found.set('manual', toActivity('manual', valid.data));
      }
      map.set(
        id,
        PRIORITY.flatMap((source) => found.get(source) ?? []),
      );
    }
    return map;
  }

  async function clearDetectedSources(userId: bigint, sources: readonly DetectedSource[]) {
    if (sources.length === 0) return;
    const fields = await valkey.hkeys(key(userId)).catch(() => [] as string[]);
    const doomed = fields.filter((field) =>
      sources.some((source) => field.startsWith(`${source}:`)),
    );
    if (doomed.length) await valkey.hdel(key(userId), ...doomed);
  }

  async function own(userId: bigint): Promise<OwnActivity> {
    const row = (await profileRows(db, [userId])).get(userId);
    const sources = sourcesOf(row);
    const manualInput = activityInputSchema.safeParse(row?.manualActivity);
    const expires = row?.manualActivityExpiresAt ?? null;
    return {
      sources,
      manual:
        row?.manualActivity && manualInput.success && (!expires || expires.getTime() > Date.now())
          ? {
              activity: toActivity('manual', manualInput.data),
              expiresAt: expires?.toISOString() ?? null,
            }
          : null,
      activities: (await activitiesOf(db, [userId])).get(userId) ?? [],
    };
  }

  return {
    activitiesOf,
    own,

    async setSources(userId: bigint, sources: ActivitySources): Promise<OwnActivity> {
      await ensureRow(userId);
      await db
        .update(userProfiles)
        .set({
          activitySources: sources,
          // Turning a source off forgets what it stored, immediately.
          ...(sources.manual ? {} : { manualActivity: null, manualActivityExpiresAt: null }),
          updatedAt: sql`now()`,
        })
        .where(eq(userProfiles.userId, userId));
      await clearDetectedSources(
        userId,
        (['game', 'rpc', 'media'] as const).filter((source) => !sources[source]),
      );
      deps.changed(userId);
      return own(userId);
    },

    async set(
      userId: bigint,
      sessionId: bigint,
      source: ActivitySource,
      input: ActivityInput,
      expiresAt: string | null,
    ): Promise<void> {
      const sources = await sourcesFor(userId);
      if (!sources[source])
        throw new AppError('FORBIDDEN', 'This activity source is turned off', { field: 'source' });
      if (source === 'manual') {
        const expires = expiresAt ? new Date(expiresAt) : null;
        if (expires && expires.getTime() <= Date.now())
          throw new AppError('VALIDATION_FAILED', 'Expiry must be in the future', {
            field: 'expiresAt',
          });
        await ensureRow(userId);
        await db
          .update(userProfiles)
          .set({ manualActivity: input, manualActivityExpiresAt: expires, updatedAt: sql`now()` })
          .where(eq(userProfiles.userId, userId));
        deps.changed(userId);
        return;
      }
      const field = `${source}:${sessionId}`;
      const previous = await valkey.hget(key(userId), field);
      const unchanged =
        previous !== null &&
        JSON.stringify((JSON.parse(previous) as StoredEntry).a) === JSON.stringify(input);
      const entry: StoredEntry = { a: input, at: Date.now() };
      await valkey
        .multi()
        .hset(key(userId), field, JSON.stringify(entry))
        .expire(key(userId), KEY_TTL_SECONDS)
        .exec();
      // Heartbeats that repeat the same activity refresh it silently.
      if (!unchanged) deps.changed(userId);
    },

    async clear(userId: bigint, sessionId: bigint, source: ActivitySource): Promise<void> {
      if (source === 'manual') {
        await db
          .update(userProfiles)
          .set({ manualActivity: null, manualActivityExpiresAt: null })
          .where(eq(userProfiles.userId, userId));
      } else {
        const removed = await valkey.hdel(key(userId), `${source}:${sessionId}`);
        if (removed === 0) return;
      }
      deps.changed(userId);
    },

    /** Clears expired manual activities so viewers drop them. */
    async sweepExpired(): Promise<number> {
      const cleared = await db
        .update(userProfiles)
        .set({ manualActivity: null, manualActivityExpiresAt: null })
        .where(
          and(
            isNotNull(userProfiles.manualActivityExpiresAt),
            lte(userProfiles.manualActivityExpiresAt, sql`now()`),
          ),
        )
        .returning({ userId: userProfiles.userId });
      for (const { userId } of cleared) deps.changed(userId);
      return cleared.length;
    },

    sources: ACTIVITY_SOURCES,
  };
}
export type ActivityService = ReturnType<typeof createActivityService>;
