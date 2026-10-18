import type { Channel, Message, MessagePage } from '@silvercord/protocol';
import type { InfiniteData } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesktopError } from '../desktop.ts';
import { advanceAccountGeneration } from './account-generation.ts';
import { api } from './api-client.ts';
import {
  fetchChannels,
  forgetChatCacheMetadata,
  markRead,
  reconcileNewest,
  refreshMessage,
  refreshVisibleMessages,
  resetMessageHistories,
  sendMessage,
  upsertMessage,
} from './chat.ts';
import { keys, queryClient } from './query-client.ts';

vi.mock('./api-client.ts', () => ({ api: vi.fn(), apiVoid: vi.fn() }));
type History = InfiniteData<MessagePage, string | null>;
const message = (id: string): Message => ({ id, channelId: '9', hidden: true });
const page = (ids: string[], nextBefore: string | null): MessagePage => ({
  items: ids.map(message),
  nextBefore,
  nextAfter: null,
});
afterEach(() => {
  queryClient.clear();
  forgetChatCacheMetadata();
  vi.resetAllMocks();
  vi.useRealTimers();
});

describe('chat cache reconciliation', () => {
  it('keeps messages when gateway fetches finish out of order', () => {
    queryClient.setQueryData<History>(keys.messages('9'), {
      pages: [page(['100'], '100')],
      pageParams: [null],
    });
    upsertMessage('9', message('102'));
    upsertMessage('9', message('101'));
    expect(
      queryClient.getQueryData<History>(keys.messages('9'))?.pages[0]?.items.map((m) => m.id),
    ).toEqual(['102', '101', '100']);
  });

  it('does not pretend an acknowledgement of an older message clears all unread counts', async () => {
    const channel = {
      id: '9',
      readState: { lastReadMessageId: '103', unreadCount: 2, mentionCount: 1 },
    } as Channel;
    queryClient.setQueryData(keys.channels, [channel]);
    queryClient.setQueryData(keys.channel('9'), channel);
    vi.mocked(api).mockResolvedValue({ channelId: '9', lastReadMessageId: '101' });
    await markRead('9', '101');
    expect(queryClient.getQueryData<Channel[]>(keys.channels)?.[0]?.readState).toEqual(
      channel.readState,
    );
  });

  it('removes stale cached rows even when the server history becomes empty', async () => {
    queryClient.setQueryData<History>(keys.messages('9'), {
      pages: [page(['100', '99'], null)],
      pageParams: [null],
    });
    vi.mocked(api).mockResolvedValue(page([], null));
    await reconcileNewest('9');
    expect(
      queryClient.getQueryData<History>(keys.messages('9'))?.pages.flatMap((p) => p.items),
    ).toEqual([]);
  });

  it('drops older cached pages on recovery so missed edits and deletes cannot survive', async () => {
    queryClient.setQueryData<History>(keys.messages('9'), {
      pages: [page(['100', '99'], '99'), page(['98', '97'], '97')],
      pageParams: [null, '99'],
    });
    vi.mocked(api).mockResolvedValue(page(['101', '100'], '100'));
    await reconcileNewest('9', true);
    expect(queryClient.getQueryData<History>(keys.messages('9'))).toEqual({
      pages: [page(['101', '100'], '100')],
      pageParams: [null],
    });
  });

  it('ignores a pre-block message response after histories were cleared', async () => {
    queryClient.setQueryData<History>(keys.messages('9'), {
      pages: [page(['100'], null)],
      pageParams: [null],
    });
    let complete: (value: Message) => void = () => {};
    vi.mocked(api).mockImplementation(
      () =>
        new Promise<Message>((resolve) => {
          complete = resolve;
        }),
    );
    const pending = refreshMessage('9', '101');
    await resetMessageHistories();
    queryClient.setQueryData<History>(keys.messages('9'), {
      pages: [page(['100'], null)],
      pageParams: [null],
    });
    complete(message('101'));
    await pending;
    expect(
      queryClient.getQueryData<History>(keys.messages('9'))?.pages[0]?.items.map((m) => m.id),
    ).toEqual(['100']);
  });

  it('does not insert a previous login send into the next login history', async () => {
    let complete: (value: Message) => void = () => {};
    vi.mocked(api).mockImplementation(
      () =>
        new Promise<Message>((resolve) => {
          complete = resolve;
        }),
    );
    const pending = sendMessage('9', 'key', { content: 'old account' });
    advanceAccountGeneration();
    queryClient.setQueryData<History>(keys.messages('9'), {
      pages: [page(['100'], null)],
      pageParams: [null],
    });
    complete(message('101'));
    await pending;
    expect(
      queryClient.getQueryData<History>(keys.messages('9'))?.pages[0]?.items.map((m) => m.id),
    ).toEqual(['100']);
  });

  it('paginates channels before sorting so an old active conversation remains visible', async () => {
    const channel = (id: string, lastMessageId: string) => ({ id, lastMessageId }) as Channel;
    vi.mocked(api)
      .mockResolvedValueOnce({ items: [channel('20', '30')], nextBefore: '20' })
      .mockResolvedValueOnce({ items: [channel('10', '100')], nextBefore: null });
    expect((await fetchChannels()).map((c) => c.id)).toEqual(['10', '20']);
    expect(vi.mocked(api).mock.calls[1]?.[1]).toContain('before=20');
  });

  it('revalidates older visible messages without rereading the 10k-row history', async () => {
    queryClient.setQueryData<History>(keys.messages('9'), {
      pages: [page(['100'], '100'), page(['50'], '50')],
      pageParams: [null, '100'],
    });
    vi.mocked(api).mockRejectedValue(new DesktopError('NOT_FOUND', 'Deleted'));
    refreshVisibleMessages('9', ['50']);
    await vi.waitFor(() => {
      expect(queryClient.getQueryData<History>(keys.messages('9'))?.pages[1]?.items).toEqual([]);
    });
    expect(api).toHaveBeenCalledTimes(1);
  });

  it('bounds viewport reads and rotates to unread snapshots before refreshing the same row', () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const ids = Array.from({ length: 45 }, (_, index) => String(index + 1));
    vi.mocked(api).mockResolvedValue(message('100'));
    refreshVisibleMessages('9', ids);
    refreshVisibleMessages('9', ids);
    expect(api).toHaveBeenCalledTimes(20);
    vi.advanceTimersByTime(5_000);
    refreshVisibleMessages('9', ids);
    expect(api).toHaveBeenCalledTimes(40);
    vi.advanceTimersByTime(5_000);
    refreshVisibleMessages('9', ids);
    expect(api).toHaveBeenCalledTimes(45);
  });
});
