import { ArrowDown } from '@phosphor-icons/react';
import type { Channel, PublicUser } from '@silvercord/protocol';
import { IconButton } from '@silvercord/ui';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { markRead, newer, useMessages } from '../../api/chat.ts';
import { useSession } from '../../session/session-store.ts';
import { discardMessage, retryMessage, useChatState } from './chat-state.ts';
import { type MessageContext, MessageItem } from './MessageItem.tsx';
import styles from './message-list.module.css';
import { buildRows, newestReadable, type Row } from './message-rows.ts';

const BOTTOM_SLACK_PX = 80;
const LOAD_OLDER_PX = 600;
const MAX_JUMP_PAGES = 20;
const localDay = (iso: string) => new Date(iso).toLocaleDateString('sv');

function Divider({ day }: { readonly day: string }) {
  const { i18n } = useTranslation();
  return (
    <p className={styles['divider']}>
      <time dateTime={day}>
        {new Intl.DateTimeFormat(i18n.language, { dateStyle: 'long' }).format(new Date(day))}
      </time>
    </p>
  );
}

function PendingRow({ row }: { readonly row: Extract<Row, { kind: 'pending' }> }) {
  const { t } = useTranslation();
  const { pending } = row;
  return (
    <div className={styles['pending']} data-state={pending.state}>
      <span className={styles['pendingText']}>{pending.content}</span>
      {pending.state === 'failed' ? (
        <span className={styles['pendingActions']}>
          <button type="button" onClick={() => retryMessage(pending.key)}>
            {t('chat.retry')}
          </button>
          <button type="button" onClick={() => discardMessage(pending.key)}>
            {t('chat.discard')}
          </button>
        </span>
      ) : null}
    </div>
  );
}

/**
 * Virtualized history: oldest at top, sticks to the bottom while the reader is there, keeps
 * the first visible row in place when older pages load above it.
 */
export function MessageList({ channel }: { readonly channel: Channel }) {
  const { t } = useTranslation();
  const selfId = useSession((s) => s.user?.id ?? '');
  const density = useChatState((s) => s.density);
  const allPending = useChatState((s) => s.pending);
  const messages = useMessages(channel.id);
  const scroller = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const anchor = useRef<{ key: string; start: number } | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);

  const pending = useMemo(
    () => allPending.filter((item) => item.channelId === channel.id),
    [allPending, channel.id],
  );
  const rows = useMemo(
    () => buildRows(messages.data?.pages ?? [], pending, localDay),
    [messages.data, pending],
  );
  const users = useMemo(() => {
    const map = new Map<string, PublicUser>(channel.members.map((member) => [member.id, member]));
    for (const row of rows)
      if (row.kind === 'message' && !row.message.hidden && row.message.author)
        map.set(row.message.author.id, row.message.author);
    return map;
  }, [channel.members, rows]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: (index) => (rows[index]?.kind === 'divider' ? 40 : 56),
    getItemKey: (index) => rows[index]?.key ?? index,
    overscan: 12,
  });

  const scrollToEnd = useCallback(() => {
    if (rows.length) virtualizer.scrollToIndex(rows.length - 1, { align: 'end' });
  }, [rows.length, virtualizer]);

  // Older page arrived: keep the previously first visible row exactly where it was.
  useLayoutEffect(() => {
    const saved = anchor.current;
    const element = scroller.current;
    if (!saved || !element) return;
    const index = rows.findIndex((row) => row.key === saved.key);
    const measurement = virtualizer.measurementsCache[index];
    if (index <= 0 || !measurement) return;
    element.scrollTop += measurement.start - saved.start;
    anchor.current = null;
  }, [rows, virtualizer]);

  // New rows, or rows growing as they are measured, while reading the bottom: follow them.
  const lastKey = rows.at(-1)?.key;
  const totalSize = virtualizer.getTotalSize();
  useLayoutEffect(() => {
    if (atBottom && lastKey && totalSize > 0) scrollToEnd();
  }, [lastKey, totalSize, atBottom, scrollToEnd]);

  const loadOlder = useCallback(() => {
    if (!messages.hasNextPage || messages.isFetchingNextPage) return;
    const element = scroller.current;
    const first = virtualizer
      .getVirtualItems()
      .find((item) => item.end > (element?.scrollTop ?? 0));
    const row = first ? rows[first.index] : undefined;
    anchor.current = first && row ? { key: row.key, start: first.start } : null;
    void messages.fetchNextPage();
  }, [messages, rows, virtualizer]);

  const onScroll = () => {
    const element = scroller.current;
    if (!element) return;
    setAtBottom(element.scrollHeight - element.scrollTop - element.clientHeight < BOTTOM_SLACK_PX);
    if (element.scrollTop < LOAD_OLDER_PX) loadOlder();
  };

  // Mark read when the newest message is on screen and the window has focus.
  const newest = newestReadable(rows);
  const lastRead = channel.readState.lastReadMessageId;
  useEffect(() => {
    if (!atBottom || !newest || !document.hasFocus()) return;
    if (lastRead && !newer(newest, lastRead)) return;
    const timer = setTimeout(() => void markRead(channel.id, newest).catch(() => undefined), 400);
    return () => clearTimeout(timer);
  }, [atBottom, newest, lastRead, channel.id]);

  const jumpTarget = useRef<string | null>(null);
  const reveal = useCallback(
    (index: number, key: string) => {
      setAtBottom(false);
      virtualizer.scrollToIndex(index, { align: 'center' });
      setHighlight(key);
      setTimeout(() => setHighlight(null), 1600);
    },
    [virtualizer],
  );
  // A jump target that needed older pages scrolls into view once its row exists.
  useLayoutEffect(() => {
    const target = jumpTarget.current;
    if (!target) return;
    const index = rows.findIndex((row) => row.key === target);
    if (index < 0) return;
    jumpTarget.current = null;
    reveal(index, target);
  }, [rows, reveal]);

  const jumpTo = useCallback(
    async (messageId: string) => {
      const index = rows.findIndex((row) => row.key === messageId);
      if (index >= 0) return reveal(index, messageId);
      jumpTarget.current = messageId;
      let result = await messages.fetchNextPage();
      for (let page = 1; page < MAX_JUMP_PAGES; page += 1) {
        const loaded = result.data?.pages.some((candidate) =>
          candidate.items.some((item) => item.id === messageId),
        );
        if (loaded || !result.hasNextPage) return;
        result = await messages.fetchNextPage();
      }
    },
    [messages, rows, reveal],
  );

  const context: MessageContext = useMemo(
    () => ({
      channelId: channel.id,
      selfId,
      users,
      density: density === 'bubble' && channel.type !== 'dm' ? 'cozy' : density,
      onJump: (id) => void jumpTo(id),
    }),
    [channel.id, channel.type, selfId, users, density, jumpTo],
  );

  return (
    <div className={styles['wrapper']}>
      <div
        ref={scroller}
        className={styles['scroller']}
        onScroll={onScroll}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label={t('chat.history')}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable log must be keyboard-scrollable.
        tabIndex={0}
      >
        <div className={styles['spacer']} style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index];
            if (!row) return null;
            return (
              <div
                key={item.key}
                data-index={item.index}
                ref={virtualizer.measureElement}
                className={styles['row']}
                data-highlight={row.key === highlight || undefined}
                style={{ transform: `translateY(${item.start}px)` }}
              >
                {row.kind === 'divider' ? (
                  <Divider day={row.day} />
                ) : row.kind === 'pending' ? (
                  <PendingRow row={row} />
                ) : (
                  <MessageItem message={row.message} grouped={row.grouped} context={context} />
                )}
              </div>
            );
          })}
        </div>
      </div>
      {atBottom ? null : (
        <IconButton
          label={t('chat.jumpToPresent')}
          className={styles['toBottom']}
          onClick={scrollToEnd}
        >
          <ArrowDown size={18} weight="bold" />
        </IconButton>
      )}
    </div>
  );
}
