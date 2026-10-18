import { Permission } from '@silvercord/permissions';
import {
  CUSTOM_REACTION_PATTERN,
  EMOTES_PER_GUILD,
  type Emote,
  type ExpressionLookup,
  type GuildExpressions,
  STICKERS_PER_GUILD,
  STICKERS_PER_MESSAGE,
  type Sticker,
  type UsableExpressions,
} from '@silvercord/protocol';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../../db/client.ts';
import { type Executor, type Transaction, uniqueViolation } from '../../db/executor.ts';
import type { EventOutbox } from '../../events/outbox.ts';
import { AppError } from '../../http/app-error.ts';
import type { GuildMembership } from '../guilds/guild-membership.ts';
import type { GuildPermissionsService } from '../guilds/guild-permissions.ts';
import type { MediaService } from '../media/media-service.ts';
import {
  type EmoteRow,
  guildEmotes,
  guildStickers,
  type StickerRow,
} from './expressions-schema.ts';

export interface ExpressionsDependencies {
  readonly db: Database;
  readonly nextId: () => bigint;
  readonly media: MediaService;
  readonly guildMembership: GuildMembership;
  readonly guildPermissions: GuildPermissionsService;
  readonly outbox: EventOutbox;
  readonly log: { warn(object: object, message: string): void };
}

const EMOTE_TOKEN = /<(a?):([A-Za-z0-9_]{2,32}):(\d{1,20})>/g;
const STICKER_TOKEN = /<sticker:(\d{1,20})>/g;
const notFound = (what: string) => new AppError('NOT_FOUND', `${what} not found`);

/**
 * Rewrites a message's expression tokens for its author (docs/spec/expressions.md): unusable
 * emotes become `:name:`, unusable or excess stickers disappear, usable ones keep their token
 * with the current name. Pure: the caller supplies what is usable.
 */
export function rewriteTokens(
  content: string,
  usableEmotes: ReadonlyMap<string, { name: string; animated: boolean }>,
  usableStickers: ReadonlySet<string>,
): string {
  let stickers = 0;
  return content
    .replace(EMOTE_TOKEN, (_token, _animated: string, name: string, id: string) => {
      const emote = usableEmotes.get(id);
      return emote ? `<${emote.animated ? 'a' : ''}:${emote.name}:${id}>` : `:${name}:`;
    })
    .replace(STICKER_TOKEN, (token, id: string) => {
      if (!usableStickers.has(id) || stickers >= STICKERS_PER_MESSAGE) return '';
      stickers += 1;
      return token;
    });
}

/** docs/spec/expressions.md */
export function createExpressionsService(deps: ExpressionsDependencies) {
  const { db, media, guildMembership, guildPermissions, outbox, log } = deps;
  const report = (message: string) => (error: unknown) => log.warn({ err: error }, message);

  async function images(ex: Executor, rows: readonly { uploadId: bigint }[]) {
    return media.profileMedia.images(
      ex,
      rows.map((row) => row.uploadId),
    );
  }

  async function emoteViews(ex: Executor, rows: readonly EmoteRow[]): Promise<Emote[]> {
    const found = await images(ex, rows);
    return rows.flatMap((row) => {
      const image = found.get(row.uploadId);
      return image
        ? [
            {
              id: row.id.toString(),
              guildId: row.guildId.toString(),
              name: row.name,
              animated: row.animated,
              image,
            },
          ]
        : [];
    });
  }

  async function stickerViews(ex: Executor, rows: readonly StickerRow[]): Promise<Sticker[]> {
    const found = await images(ex, rows);
    return rows.flatMap((row) => {
      const image = found.get(row.uploadId);
      return image
        ? [
            {
              id: row.id.toString(),
              guildId: row.guildId.toString(),
              name: row.name,
              description: row.description,
              relatedEmoji: row.relatedEmoji,
              animated: row.animated,
              image,
            },
          ]
        : [];
    });
  }

  async function requireManager(tx: Executor, guildId: bigint, userId: bigint) {
    await guildPermissions.requireGuild(tx, guildId, userId, Permission.MANAGE_EMOJIS);
  }

  async function announce(tx: Transaction, guildId: bigint) {
    const members = await guildMembership.memberIds(tx, guildId);
    await outbox.enqueue(tx, 'GUILD_CHANGED', members, { guildId: guildId.toString() });
  }

  async function guildIdsOf(ex: Executor, userId: bigint) {
    return (await guildMembership.guildsOf(ex, userId)).map((guild) => guild.id);
  }

  for (const purpose of ['emote', 'sticker'] as const) {
    media.definePurpose(purpose, {
      async authorizeUpload(ex, ownerId, guildId) {
        if (guildId === null) throw notFound('Server');
        await requireManager(ex, guildId, ownerId);
      },
      async canView(ex, _viewerId, upload) {
        const table = purpose === 'emote' ? guildEmotes : guildStickers;
        const [row] = await ex
          .select({ id: table.id })
          .from(table)
          .where(eq(table.uploadId, upload.id))
          .limit(1);
        return row !== undefined;
      },
    });
  }

  const purge = async (ids: readonly bigint[]) => {
    for (const id of ids) await media.purge(id).catch(report('expression purge failed'));
  };

  return {
    async guild(viewerId: bigint, guildId: bigint): Promise<GuildExpressions> {
      if (!(await guildMembership.isMember(db, guildId, viewerId))) throw notFound('Server');
      const [emotes, stickers] = await Promise.all([
        db.select().from(guildEmotes).where(eq(guildEmotes.guildId, guildId)),
        db.select().from(guildStickers).where(eq(guildStickers.guildId, guildId)),
      ]);
      return { emotes: await emoteViews(db, emotes), stickers: await stickerViews(db, stickers) };
    },

    async usable(userId: bigint): Promise<UsableExpressions> {
      const guilds = await guildMembership.guildsOf(db, userId);
      const ids = guilds.map((guild) => guild.id);
      if (ids.length === 0) return { guilds: [] };
      const [emotes, stickers] = await Promise.all([
        db.select().from(guildEmotes).where(inArray(guildEmotes.guildId, ids)),
        db.select().from(guildStickers).where(inArray(guildStickers.guildId, ids)),
      ]);
      const [emoteList, stickerList] = await Promise.all([
        emoteViews(db, emotes),
        stickerViews(db, stickers),
      ]);
      return {
        guilds: guilds.map((guild) => ({
          guildId: guild.id.toString(),
          name: guild.name,
          emotes: emoteList.filter((emote) => emote.guildId === guild.id.toString()),
          stickers: stickerList.filter((sticker) => sticker.guildId === guild.id.toString()),
        })),
      };
    },

    /** Rendering data for any live ids; viewing never needs membership. */
    async lookup(
      emoteIds: readonly string[],
      stickerIds: readonly string[],
    ): Promise<ExpressionLookup> {
      const [emotes, stickers] = await Promise.all([
        emoteIds.length
          ? db
              .select()
              .from(guildEmotes)
              .where(inArray(guildEmotes.id, emoteIds.map(BigInt)))
          : [],
        stickerIds.length
          ? db
              .select()
              .from(guildStickers)
              .where(inArray(guildStickers.id, stickerIds.map(BigInt)))
          : [],
      ]);
      return { emotes: await emoteViews(db, emotes), stickers: await stickerViews(db, stickers) };
    },

    async createEmote(actorId: bigint, guildId: bigint, name: string, uploadId: string) {
      const row = await db
        .transaction(async (tx) => {
          await requireManager(tx, guildId, actorId);
          const upload = await media.profileMedia.claim(tx, {
            ownerId: actorId,
            uploadId: BigInt(uploadId),
            purpose: 'emote',
            guildId,
            field: 'uploadId',
          });
          const [count] = await tx
            .select({ value: sql<number>`count(*)::int` })
            .from(guildEmotes)
            .where(
              and(eq(guildEmotes.guildId, guildId), eq(guildEmotes.animated, upload.animated)),
            );
          const cap = upload.animated ? EMOTES_PER_GUILD.animated : EMOTES_PER_GUILD.static;
          if ((count?.value ?? 0) >= cap) throw new AppError('CONFLICT', 'Emote limit reached');
          const [inserted] = await tx
            .insert(guildEmotes)
            .values({
              id: deps.nextId(),
              guildId,
              name,
              uploadId: upload.id,
              animated: upload.animated,
              createdBy: actorId,
            })
            .returning();
          if (!inserted) throw new Error('insert returned no row');
          await announce(tx, guildId);
          return inserted;
        })
        .catch((error: unknown) => {
          if (uniqueViolation(error) === 'guild_emotes_guild_name_unique')
            throw new AppError('CONFLICT', 'Name already used', { field: 'name' });
          throw error;
        });
      const [view] = await emoteViews(db, [row]);
      if (!view) throw notFound('Emote');
      return view;
    },

    async renameEmote(actorId: bigint, guildId: bigint, emoteId: bigint, name: string) {
      const row = await db
        .transaction(async (tx) => {
          await requireManager(tx, guildId, actorId);
          const [updated] = await tx
            .update(guildEmotes)
            .set({ name })
            .where(and(eq(guildEmotes.id, emoteId), eq(guildEmotes.guildId, guildId)))
            .returning();
          if (!updated) throw notFound('Emote');
          await announce(tx, guildId);
          return updated;
        })
        .catch((error: unknown) => {
          if (uniqueViolation(error) === 'guild_emotes_guild_name_unique')
            throw new AppError('CONFLICT', 'Name already used', { field: 'name' });
          throw error;
        });
      const [view] = await emoteViews(db, [row]);
      if (!view) throw notFound('Emote');
      return view;
    },

    async deleteEmote(actorId: bigint, guildId: bigint, emoteId: bigint) {
      const released = await db.transaction(async (tx) => {
        await requireManager(tx, guildId, actorId);
        const [removed] = await tx
          .delete(guildEmotes)
          .where(and(eq(guildEmotes.id, emoteId), eq(guildEmotes.guildId, guildId)))
          .returning();
        if (!removed) throw notFound('Emote');
        await announce(tx, guildId);
        return media.profileMedia.release(tx, [removed.uploadId]);
      });
      await purge(released);
    },

    async createSticker(
      actorId: bigint,
      guildId: bigint,
      input: { name: string; description: string; relatedEmoji: string | null; uploadId: string },
    ) {
      const row = await db.transaction(async (tx) => {
        await requireManager(tx, guildId, actorId);
        const upload = await media.profileMedia.claim(tx, {
          ownerId: actorId,
          uploadId: BigInt(input.uploadId),
          purpose: 'sticker',
          guildId,
          field: 'uploadId',
        });
        const [count] = await tx
          .select({ value: sql<number>`count(*)::int` })
          .from(guildStickers)
          .where(eq(guildStickers.guildId, guildId));
        if ((count?.value ?? 0) >= STICKERS_PER_GUILD)
          throw new AppError('CONFLICT', 'Sticker limit reached');
        const [inserted] = await tx
          .insert(guildStickers)
          .values({
            id: deps.nextId(),
            guildId,
            name: input.name,
            description: input.description,
            relatedEmoji: input.relatedEmoji,
            uploadId: upload.id,
            animated: upload.animated,
            createdBy: actorId,
          })
          .returning();
        if (!inserted) throw new Error('insert returned no row');
        await announce(tx, guildId);
        return inserted;
      });
      const [view] = await stickerViews(db, [row]);
      if (!view) throw notFound('Sticker');
      return view;
    },

    async updateSticker(
      actorId: bigint,
      guildId: bigint,
      stickerId: bigint,
      patch: {
        name?: string | undefined;
        description?: string | undefined;
        relatedEmoji?: string | null | undefined;
      },
    ) {
      const row = await db.transaction(async (tx) => {
        await requireManager(tx, guildId, actorId);
        const [updated] = await tx
          .update(guildStickers)
          .set(patch)
          .where(and(eq(guildStickers.id, stickerId), eq(guildStickers.guildId, guildId)))
          .returning();
        if (!updated) throw notFound('Sticker');
        await announce(tx, guildId);
        return updated;
      });
      const [view] = await stickerViews(db, [row]);
      if (!view) throw notFound('Sticker');
      return view;
    },

    async deleteSticker(actorId: bigint, guildId: bigint, stickerId: bigint) {
      const released = await db.transaction(async (tx) => {
        await requireManager(tx, guildId, actorId);
        const [removed] = await tx
          .delete(guildStickers)
          .where(and(eq(guildStickers.id, stickerId), eq(guildStickers.guildId, guildId)))
          .returning();
        if (!removed) throw notFound('Sticker');
        await announce(tx, guildId);
        return media.profileMedia.release(tx, [removed.uploadId]);
      });
      await purge(released);
    },

    /** The messages module's view (docs/spec/expressions.md). */
    messages: {
      async sanitize(ex: Executor, authorId: bigint, content: string): Promise<string> {
        const emoteIds = [...content.matchAll(EMOTE_TOKEN)].map((match) => match[3] ?? '');
        const stickerIds = [...content.matchAll(STICKER_TOKEN)].map((match) => match[1] ?? '');
        if (emoteIds.length === 0 && stickerIds.length === 0) return content;
        const guildIds = await guildIdsOf(ex, authorId);
        const [emotes, stickers] = await Promise.all([
          emoteIds.length && guildIds.length
            ? ex
                .select()
                .from(guildEmotes)
                .where(
                  and(
                    inArray(guildEmotes.id, emoteIds.filter(Boolean).map(BigInt)),
                    inArray(guildEmotes.guildId, guildIds),
                  ),
                )
            : [],
          stickerIds.length && guildIds.length
            ? ex
                .select({ id: guildStickers.id })
                .from(guildStickers)
                .where(
                  and(
                    inArray(guildStickers.id, stickerIds.filter(Boolean).map(BigInt)),
                    inArray(guildStickers.guildId, guildIds),
                  ),
                )
            : [],
        ]);
        return rewriteTokens(
          content,
          new Map(emotes.map((row) => [row.id.toString(), row])),
          new Set(stickers.map((row) => row.id.toString())),
        );
      },

      async canReact(ex: Executor, actorId: bigint, emoji: string): Promise<boolean> {
        const match = CUSTOM_REACTION_PATTERN.exec(emoji);
        if (!match?.[1]) return true;
        const guildIds = await guildIdsOf(ex, actorId);
        if (guildIds.length === 0) return false;
        const [row] = await ex
          .select({ id: guildEmotes.id })
          .from(guildEmotes)
          .where(and(eq(guildEmotes.id, BigInt(match[1])), inArray(guildEmotes.guildId, guildIds)))
          .limit(1);
        return row !== undefined;
      },
    },
  };
}
export type ExpressionsService = ReturnType<typeof createExpressionsService>;
export type MessageExpressions = ExpressionsService['messages'];
