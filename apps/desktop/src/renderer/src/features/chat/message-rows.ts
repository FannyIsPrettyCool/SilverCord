import type { Message } from '@silvercord/protocol';
import type { PendingMessage } from './chat-state.ts';

export type Row =
  | { readonly kind: 'divider'; readonly key: string; readonly day: string }
  | {
      readonly kind: 'message';
      readonly key: string;
      readonly message: Message;
      readonly grouped: boolean;
    }
  | { readonly kind: 'pending'; readonly key: string; readonly pending: PendingMessage };

/** Consecutive messages by one author within this window share a header. */
const GROUP_WINDOW_MS = 7 * 60 * 1000;

const dayOf = (iso: string) => iso.slice(0, 10);

/**
 * Builds display rows, oldest first, from newest-first pages: deduplicated, with day dividers
 * and author grouping. Pending sends come last, in send order.
 */
export function buildRows(
  pages: readonly { readonly items: readonly Message[] }[],
  pending: readonly PendingMessage[],
  localDay: (iso: string) => string = dayOf,
): Row[] {
  const seen = new Set<string>();
  const messages: Message[] = [];
  for (const page of pages) {
    for (const item of page.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      messages.push(item);
    }
  }
  messages.reverse();
  const rows: Row[] = [];
  let previous: Message | undefined;
  let lastDay: string | undefined;
  for (const message of messages) {
    const createdAt = message.hidden ? undefined : message.createdAt;
    if (createdAt) {
      const day = localDay(createdAt);
      if (day !== lastDay) {
        rows.push({ kind: 'divider', key: `day-${day}`, day: createdAt });
        lastDay = day;
        previous = undefined;
      }
    }
    const grouped =
      previous !== undefined &&
      !previous.hidden &&
      !message.hidden &&
      previous.author?.id === message.author?.id &&
      message.reply === null &&
      Date.parse(message.createdAt) - Date.parse(previous.createdAt) < GROUP_WINDOW_MS;
    rows.push({ kind: 'message', key: message.id, message, grouped });
    previous = message;
  }
  for (const item of pending)
    rows.push({ kind: 'pending', key: `pending-${item.key}`, pending: item });
  return rows;
}

/** Newest visible (non-hidden) message id, the target for marking the channel read. */
export function newestReadable(rows: readonly Row[]): string | undefined {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (row?.kind === 'message' && !row.message.hidden) return row.message.id;
  }
  return undefined;
}
