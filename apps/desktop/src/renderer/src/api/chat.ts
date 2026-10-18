import {
  type Channel,
  channelPageSchema,
  channelSchema,
  type Message,
  type MessagePage,
  messagePageSchema,
  messageSchema,
  type OpenChannelRequest,
  readStateSchema,
} from '@silvercord/protocol';
import { type InfiniteData, useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { DesktopError } from '../desktop.ts';
import { api, apiVoid } from './api-client.ts';
import { keys, queryClient } from './query-client.ts';

const PAGE_SIZE = 50;

/** Snowflake ids sort numerically; compare as BigInt so long ids never lose precision. */
export const newer = (a: string, b: string) => BigInt(a) > BigInt(b);

export function useChannels() {
  return useQuery({
    queryKey: keys.channels,
    queryFn: async () => {
      const page = await api(channelPageSchema, '/api/v1/users/@me/channels?limit=100');
      // Most recent activity first; a channel without messages sorts by its own id.
      return [...page.items].sort((a, b) =>
        newer(a.lastMessageId ?? a.id, b.lastMessageId ?? b.id) ? -1 : 1,
      );
    },
  });
}

export function useChannel(channelId: string) {
  return useQuery({
    queryKey: keys.channel(channelId),
    queryFn: () => api(channelSchema, `/api/v1/channels/${channelId}`),
  });
}

export function useOpenChannel() {
  return useMutation({
    mutationFn: (request: OpenChannelRequest) =>
      api(channelSchema, '/api/v1/users/@me/channels', { method: 'POST', body: request }),
    onSuccess: async (channel) => {
      queryClient.setQueryData(keys.channel(channel.id), channel);
      await queryClient.invalidateQueries({ queryKey: keys.channels });
    },
  });
}

export function useChannelMembers(channelId: string) {
  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: keys.channel(channelId) }),
      queryClient.invalidateQueries({ queryKey: keys.channels }),
    ]);
  return {
    add: useMutation({
      mutationFn: (userId: string) =>
        apiVoid(`/api/v1/channels/${channelId}/members/${userId}`, { method: 'PUT', body: {} }),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (userId: string) =>
        apiVoid(`/api/v1/channels/${channelId}/members/${userId}`, { method: 'DELETE' }),
      onSuccess: invalidate,
    }),
    rename: useMutation({
      mutationFn: ({ name, expectedVersion }: { name: string | null; expectedVersion: number }) =>
        api(channelSchema, `/api/v1/channels/${channelId}`, {
          method: 'PATCH',
          body: { name, expectedVersion },
        }),
      onSuccess: invalidate,
    }),
  };
}

export function useMessages(channelId: string) {
  return useInfiniteQuery({
    queryKey: keys.messages(channelId),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api(
        messagePageSchema,
        `/api/v1/channels/${channelId}/messages?limit=${PAGE_SIZE}${pageParam ? `&before=${pageParam}` : ''}`,
      ),
    getNextPageParam: (page) => page.nextBefore,
    // History is kept fresh by targeted gateway upserts and reconciliation, not refetching.
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  });
}

type MessagesData = InfiniteData<MessagePage, string | null>;

/** Inserts or replaces one message in the cached history; older unloaded ones are ignored. */
export function upsertMessage(channelId: string, message: Message) {
  queryClient.setQueryData<MessagesData>(keys.messages(channelId), (data) => {
    if (!data) return data;
    let found = false;
    const pages = data.pages.map((page) => ({
      ...page,
      items: page.items.map((item) => {
        if (item.id !== message.id) return item;
        found = true;
        return message;
      }),
    }));
    const first = pages[0];
    if (!found && first) {
      const newest = first.items[0];
      if (!newest || newer(message.id, newest.id)) first.items = [message, ...first.items];
    }
    return { ...data, pages };
  });
}

export function removeMessage(channelId: string, messageId: string) {
  queryClient.setQueryData<MessagesData>(keys.messages(channelId), (data) =>
    data
      ? {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            items: page.items.filter((item) => item.id !== messageId),
          })),
        }
      : data,
  );
}

/** Refetches one message after an invalidation; a 404 means it is gone for this viewer. */
export async function refreshMessage(channelId: string, messageId: string) {
  try {
    upsertMessage(
      channelId,
      await api(messageSchema, `/api/v1/channels/${channelId}/messages/${messageId}`),
    );
  } catch (error) {
    if (error instanceof DesktopError && error.code === 'NOT_FOUND')
      removeMessage(channelId, messageId);
    else throw error;
  }
}

/**
 * Reconciles the newest page with the cache. When it no longer overlaps what is cached (a gap
 * after a long disconnect), older pages are dropped rather than shown with a hole.
 */
export async function reconcileNewest(channelId: string) {
  const data = queryClient.getQueryData<MessagesData>(keys.messages(channelId));
  if (!data) return;
  const fresh = await api(
    messagePageSchema,
    `/api/v1/channels/${channelId}/messages?limit=${PAGE_SIZE}`,
  );
  queryClient.setQueryData<MessagesData>(keys.messages(channelId), (current) => {
    if (!current) return current;
    const cachedIds = new Set(current.pages.flatMap((page) => page.items.map((item) => item.id)));
    const oldestFresh = fresh.items.at(-1);
    const overlaps = !oldestFresh || cachedIds.has(oldestFresh.id) || fresh.nextBefore === null;
    if (!overlaps) return { pages: [fresh], pageParams: [null] };
    const freshIds = new Set(fresh.items.map((item) => item.id));
    const older = current.pages.map((page, index) => ({
      ...page,
      items: page.items.filter(
        (item) =>
          !freshIds.has(item.id) && (index > 0 || !oldestFresh || !newer(item.id, oldestFresh.id)),
      ),
    }));
    const [first, ...rest] = older;
    // Older cached items stay in the first page, so its cursor keeps pointing past them.
    const nextBefore = first?.items.length
      ? (current.pages[0]?.nextBefore ?? null)
      : fresh.nextBefore;
    return {
      ...current,
      pages: [{ ...fresh, nextBefore, items: [...fresh.items, ...(first?.items ?? [])] }, ...rest],
    };
  });
}

export function useMessageActions(channelId: string) {
  return {
    edit: useMutation({
      mutationFn: ({
        messageId,
        content,
        expectedVersion,
      }: {
        messageId: string;
        content: string;
        expectedVersion: number;
      }) =>
        api(messageSchema, `/api/v1/channels/${channelId}/messages/${messageId}`, {
          method: 'PATCH',
          body: { content, expectedVersion },
        }),
      onSuccess: (message) => upsertMessage(channelId, message),
    }),
    remove: useMutation({
      mutationFn: (messageId: string) =>
        apiVoid(`/api/v1/channels/${channelId}/messages/${messageId}`, { method: 'DELETE' }),
      onSuccess: (_result, messageId) => removeMessage(channelId, messageId),
    }),
    react: useMutation({
      mutationFn: ({ messageId, emoji, add }: { messageId: string; emoji: string; add: boolean }) =>
        apiVoid(
          `/api/v1/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`,
          add ? { method: 'PUT', body: {} } : { method: 'DELETE' },
        ),
      onSuccess: (_result, { messageId }) => refreshMessage(channelId, messageId),
    }),
  };
}

export async function sendMessage(
  channelId: string,
  key: string,
  body: { content: string; replyToId?: string; attachmentIds?: string[] },
): Promise<Message> {
  const message = await api(messageSchema, `/api/v1/channels/${channelId}/messages`, {
    method: 'POST',
    body,
    headers: { 'idempotency-key': key },
  });
  upsertMessage(channelId, message);
  return message;
}

/** Monotonic on the server; the cached channel list is updated optimistically. */
export async function markRead(channelId: string, messageId: string) {
  const state = await api(readStateSchema, `/api/v1/channels/${channelId}/read-state`, {
    method: 'PUT',
    body: { messageId },
  });
  const apply = (channel: Channel): Channel =>
    channel.id === channelId
      ? {
          ...channel,
          readState: {
            lastReadMessageId: state.lastReadMessageId,
            unreadCount: 0,
            mentionCount: 0,
          },
        }
      : channel;
  queryClient.setQueryData<Channel[]>(keys.channels, (channels) => channels?.map(apply));
  queryClient.setQueryData<Channel>(
    keys.channel(channelId),
    (channel) => channel && apply(channel),
  );
}
