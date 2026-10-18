import { createHash } from 'node:crypto';
import { mentionedUserIds, parse, toPlainText } from '@silvercord/markdown';
import {
  type Attachment,
  type EditMessageRequest,
  type Message,
  type MessagePage,
  type MessageReply,
  REPLY_EXCERPT_MAX,
  type ReactionSummary,
  type ReadState,
  type ReadStateView,
} from '@silvercord/protocol';
import type { Executor, Transaction } from '../../db/executor.ts';
import { uniqueViolation } from '../../db/executor.ts';
import type { EventOutbox } from '../../events/outbox.ts';
import { AppError } from '../../http/app-error.ts';
import type { ChannelsService } from '../channels/channels-service.ts';
import type { RelationshipsService } from '../relationships/relationships-service.ts';
import type { UsersService } from '../users/users-service.ts';
import { messagesRepository as repo } from './messages-repository.ts';
import type { MessageRow } from './messages-schema.ts';

/** The media module's surface as seen by messages; attachments are owned by media. */
export interface MessageMedia {
  /** Attaches ready uploads inside the message transaction; throws on any invalid id. */
  attach(
    tx: Transaction,
    input: { ownerId: bigint; channelId: bigint; messageId: bigint; uploadIds: bigint[] },
  ): Promise<void>;
  views(ex: Executor, messageIds: readonly bigint[]): Promise<Map<bigint, Attachment[]>>;
  /** Called before a message row is deleted so stored objects get scheduled for removal. */
  release(tx: Transaction, messageIds: readonly bigint[]): Promise<void>;
}

/** Until the media module lands, no attachment id is valid. */
export const noMessageMedia: MessageMedia = {
  async attach(_tx, input) {
    if (input.uploadIds.length) throw new AppError('NOT_FOUND', 'Upload not found');
  },
  async views() {
    return new Map();
  },
  async release() {},
};

export interface MessagesDependencies {
  readonly users: UsersService;
  readonly relationships: RelationshipsService;
  readonly channels: ChannelsService;
  readonly outbox: EventOutbox;
  readonly media: MessageMedia;
  readonly nextId: () => bigint;
}

export interface SendInput {
  readonly content: string;
  readonly replyToId?: string | null | undefined;
  readonly attachmentIds?: readonly string[] | undefined;
}

const messageNotFound = () => new AppError('NOT_FOUND', 'Message not found');

function requestHash(channelId: bigint, input: SendInput): Buffer {
  const canonical = JSON.stringify([
    channelId.toString(),
    input.content,
    input.replyToId ?? null,
    input.attachmentIds ?? [],
  ]);
  return createHash('sha256').update(canonical).digest();
}

function excerpt(content: string): string {
  const text = toPlainText(parse(content)).replace(/\s+/g, ' ').trim();
  const points = [...text];
  return points.length > REPLY_EXCERPT_MAX
    ? `${points.slice(0, REPLY_EXCERPT_MAX).join('')}…`
    : text;
}

/** Mentioned ids that are current members other than the author, from recognized AST nodes. */
function mentionTargets(content: string, memberIds: readonly bigint[], authorId: bigint) {
  const members = new Set(memberIds.map(String));
  return mentionedUserIds(parse(content))
    .filter((id) => members.has(id) && id !== authorId.toString())
    .map(BigInt);
}

/**
 * Private messages (docs/spec/messaging.md). Every operation re-checks current membership via
 * ChannelsService; content never enters the outbox, only ids.
 */
export function createMessagesService(deps: MessagesDependencies) {
  const { channels, relationships, outbox, media } = deps;

  async function announce(
    tx: Transaction,
    channelId: bigint,
    messageId: bigint,
    recipients: readonly bigint[],
  ) {
    await outbox.enqueue(tx, 'MESSAGE_CHANGED', recipients, {
      channelId: channelId.toString(),
      messageId: messageId.toString(),
    });
  }

  /** Builds viewer-specific views for rows of one channel without per-row queries. */
  async function views(ex: Executor, viewerId: bigint, rows: readonly MessageRow[]) {
    if (rows.length === 0) return [];
    const blocked = await relationships.blockedByViewer(ex, viewerId);
    const visibleRows = rows.filter((row) => row.authorId === null || !blocked.has(row.authorId));
    const ids = visibleRows.map((row) => row.id);
    const channelId = rows[0]?.channelId ?? 0n;
    const replyIds = visibleRows.flatMap((row) => (row.replyToId === null ? [] : [row.replyToId]));
    const [targets, reactionRows, mentionRows, attachments] = await Promise.all([
      repo.findMany(ex, channelId, replyIds),
      repo.reactionSummaries(ex, ids, viewerId, [...blocked]),
      repo.mentionsOf(ex, ids),
      media.views(ex, ids),
    ]);
    const authorIds = [...visibleRows, ...targets].flatMap((row) =>
      row.authorId === null ? [] : [row.authorId],
    );
    const cards = new Map(
      (await deps.users.findPublicByIds(ex, authorIds)).map((user) => [user.id, user]),
    );
    const card = (authorId: bigint | null) =>
      authorId === null ? null : (cards.get(authorId.toString()) ?? null);
    const targetById = new Map(targets.map((row) => [row.id, row]));
    const reactions = new Map<bigint, ReactionSummary[]>();
    for (const row of reactionRows) {
      const list = reactions.get(row.messageId) ?? [];
      list.push({ emoji: row.emoji, count: row.count, me: row.me });
      reactions.set(row.messageId, list);
    }
    const mentions = new Map<bigint, string[]>();
    for (const row of mentionRows) {
      const list = mentions.get(row.messageId) ?? [];
      list.push(row.userId.toString());
      mentions.set(row.messageId, list);
    }

    const reply = (row: MessageRow): MessageReply | null => {
      if (!row.isReply) return null;
      const target = row.replyToId === null ? undefined : targetById.get(row.replyToId);
      if (!target) return { state: 'missing' };
      if (target.authorId !== null && blocked.has(target.authorId))
        return { state: 'hidden', id: target.id.toString() };
      return {
        state: 'visible',
        id: target.id.toString(),
        author: card(target.authorId),
        excerpt: excerpt(target.content),
      };
    };

    return rows.map((row): Message => {
      const base = { id: row.id.toString(), channelId: row.channelId.toString() };
      if (row.authorId !== null && blocked.has(row.authorId)) return { ...base, hidden: true };
      return {
        ...base,
        hidden: false,
        author: card(row.authorId),
        content: row.content,
        mentions: mentions.get(row.id) ?? [],
        reply: reply(row),
        reactions: reactions.get(row.id) ?? [],
        attachments: attachments.get(row.id) ?? [],
        version: row.version,
        createdAt: row.createdAt.toISOString(),
        editedAt: row.editedAt?.toISOString() ?? null,
      };
    });
  }

  async function single(ex: Executor, viewerId: bigint, channelId: bigint, messageId: bigint) {
    const row = await repo.find(ex, channelId, messageId);
    if (!row) throw messageNotFound();
    const [view] = await views(ex, viewerId, [row]);
    if (!view) throw messageNotFound();
    return view;
  }

  async function createInTransaction(
    tx: Transaction,
    authorId: bigint,
    channelId: bigint,
    key: string,
    input: SendInput,
  ): Promise<bigint> {
    const { channel, memberIds } = await channels.lockForSend(tx, channelId, authorId);
    const hash = requestHash(channelId, input);
    const previous = await repo.findIdempotency(tx, authorId, key);
    if (previous) {
      if (!previous.requestHash.equals(hash))
        throw new AppError('CONFLICT', 'Idempotency key reused with a different request');
      // Same request again: return the original without new rows, events or attachments.
      if (!(await repo.find(tx, channelId, previous.messageId))) throw messageNotFound();
      return previous.messageId;
    }
    const uploadIds = (input.attachmentIds ?? []).map(BigInt);
    if (input.content.trim() === '' && uploadIds.length === 0)
      throw new AppError('VALIDATION_FAILED', 'Message is empty', { field: 'content' });
    let replyToId: bigint | null = null;
    if (input.replyToId) {
      const target = await repo.find(tx, channelId, BigInt(input.replyToId));
      const blocked = await relationships.blockedByViewer(tx, authorId);
      if (!target || (target.authorId !== null && blocked.has(target.authorId)))
        throw new AppError('NOT_FOUND', 'Reply target not found', { field: 'replyToId' });
      replyToId = target.id;
    }
    const id = deps.nextId();
    // Ids order the channel; refuse rather than insert behind the newest message.
    if (channel.lastMessageId !== null && id <= channel.lastMessageId)
      throw new AppError('INTERNAL', 'Clock moved backwards; retry');
    await repo.insert(tx, {
      id,
      channelId,
      authorId,
      content: input.content,
      replyToId,
      isReply: replyToId !== null,
    });
    await repo.insertIdempotency(tx, {
      authorId,
      key,
      channelId,
      requestHash: hash,
      messageId: id,
    });
    await repo.setMentions(tx, id, mentionTargets(input.content, memberIds, authorId));
    await media.attach(tx, { ownerId: authorId, channelId, messageId: id, uploadIds });
    await channels.setLastMessage(tx, channelId, id);
    await repo.advanceReadState(tx, authorId, channelId, id);
    await announce(tx, channelId, id, memberIds);
    await outbox.enqueue(tx, 'READ_STATE_CHANGED', [authorId], { channelId: channelId.toString() });
    return id;
  }

  return {
    views,

    async send(
      ex: Executor,
      authorId: bigint,
      channelId: bigint,
      key: string,
      input: SendInput,
    ): Promise<Message> {
      let messageId: bigint;
      try {
        messageId = await ex.transaction((tx) =>
          createInTransaction(tx, authorId, channelId, key, input),
        );
      } catch (error) {
        // Two concurrent first uses of one key in different channels: the loser re-reads.
        if (uniqueViolation(error) !== 'message_idempotency_author_id_key_pk') throw error;
        messageId = await ex.transaction((tx) =>
          createInTransaction(tx, authorId, channelId, key, input),
        );
      }
      return single(ex, authorId, channelId, messageId);
    },

    async page(
      ex: Executor,
      viewerId: bigint,
      channelId: bigint,
      query: { before?: string | undefined; after?: string | undefined; limit: number },
    ): Promise<MessagePage> {
      await channels.requireMember(ex, channelId, viewerId);
      const rows = await repo.page(ex, channelId, query);
      const hasMore = rows.length > query.limit;
      const selected = rows.slice(0, query.limit);
      if (query.after) selected.reverse();
      const items = await views(ex, viewerId, selected);
      return {
        items,
        nextBefore: !query.after && hasMore ? (items.at(-1)?.id ?? null) : null,
        nextAfter: query.after && hasMore ? (items[0]?.id ?? null) : null,
      };
    },

    async get(ex: Executor, viewerId: bigint, channelId: bigint, messageId: bigint) {
      await channels.requireMember(ex, channelId, viewerId);
      return single(ex, viewerId, channelId, messageId);
    },

    async edit(
      ex: Executor,
      actorId: bigint,
      channelId: bigint,
      messageId: bigint,
      input: EditMessageRequest,
    ): Promise<Message> {
      await ex.transaction(async (tx) => {
        await channels.requireMember(tx, channelId, actorId, 'share');
        const row = await repo.find(tx, channelId, messageId, 'update');
        if (!row) throw messageNotFound();
        if (row.authorId !== actorId)
          throw new AppError('FORBIDDEN', 'Only the author can edit a message');
        if (row.version !== input.expectedVersion)
          throw new AppError('CONFLICT', 'Message changed; reload and retry');
        if (row.content === input.content) return;
        if (input.content.trim() === '') {
          const attached = (await media.views(tx, [messageId])).get(messageId) ?? [];
          if (attached.length === 0)
            throw new AppError('VALIDATION_FAILED', 'Message is empty', { field: 'content' });
        }
        const memberIds = await channels.memberIds(tx, channelId);
        await repo.updateContent(tx, messageId, input.content);
        await repo.setMentions(tx, messageId, mentionTargets(input.content, memberIds, actorId));
        await announce(tx, channelId, messageId, memberIds);
      });
      return single(ex, actorId, channelId, messageId);
    },

    async remove(ex: Executor, actorId: bigint, channelId: bigint, messageId: bigint) {
      await ex.transaction(async (tx) => {
        await channels.requireMember(tx, channelId, actorId, 'share');
        const row = await repo.find(tx, channelId, messageId, 'update');
        if (!row) {
          if (await repo.authoredDeleted(tx, actorId, channelId, messageId)) return;
          throw messageNotFound();
        }
        if (row.authorId !== actorId)
          throw new AppError('FORBIDDEN', 'Only the author can delete a message');
        await media.release(tx, [messageId]);
        await repo.delete(tx, messageId);
        await announce(tx, channelId, messageId, await channels.memberIds(tx, channelId));
      });
    },

    async react(
      ex: Executor,
      actorId: bigint,
      channelId: bigint,
      messageId: bigint,
      emoji: string,
      add: boolean,
    ) {
      await ex.transaction(async (tx) => {
        await channels.requireMember(tx, channelId, actorId, 'share');
        const row = await repo.find(tx, channelId, messageId, 'update');
        const blocked = await relationships.blockedByViewer(tx, actorId);
        if (!row || (row.authorId !== null && blocked.has(row.authorId))) throw messageNotFound();
        let changed: boolean | 'limit';
        if (add) {
          if (!(await channels.canInteract(tx, channelId, actorId)))
            throw new AppError('FORBIDDEN', 'You cannot react in this conversation');
          changed = await repo.addReaction(tx, messageId, actorId, emoji);
          if (changed === 'limit') throw new AppError('CONFLICT', 'Reaction limit reached');
        } else {
          changed = await repo.removeReaction(tx, messageId, actorId, emoji);
        }
        if (changed)
          await announce(tx, channelId, messageId, await channels.memberIds(tx, channelId));
      });
    },

    async markRead(
      ex: Executor,
      viewerId: bigint,
      channelId: bigint,
      messageId: bigint,
    ): Promise<ReadState> {
      return ex.transaction(async (tx) => {
        await channels.requireMember(tx, channelId, viewerId, 'share');
        const target = await repo.find(tx, channelId, messageId);
        const blocked = await relationships.blockedByViewer(tx, viewerId);
        if (!target || (target.authorId !== null && blocked.has(target.authorId)))
          throw new AppError('NOT_FOUND', 'Message not found', { field: 'messageId' });
        if (await repo.advanceReadState(tx, viewerId, channelId, messageId))
          await outbox.enqueue(tx, 'READ_STATE_CHANGED', [viewerId], {
            channelId: channelId.toString(),
          });
        const last = await repo.readState(tx, viewerId, channelId);
        return { channelId: channelId.toString(), lastReadMessageId: last?.toString() ?? null };
      });
    },

    /** Own read position and capped counts for channels the viewer is known to belong to. */
    async readStateViews(
      ex: Executor,
      viewerId: bigint,
      channelIds: readonly bigint[],
    ): Promise<Map<bigint, ReadStateView>> {
      const blocked = await relationships.blockedByViewer(ex, viewerId);
      const rows = await repo.unreadCounts(ex, viewerId, channelIds, [...blocked]);
      return new Map(
        rows.map((row) => [
          row.channelId,
          {
            lastReadMessageId: row.lastReadMessageId,
            unreadCount: row.unreadCount,
            mentionCount: row.mentionCount,
          },
        ]),
      );
    },
  };
}
export type MessagesService = ReturnType<typeof createMessagesService>;
