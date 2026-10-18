import {
  type Channel,
  type ChannelPage,
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
import {
  captureAccountGeneration,
  isCurrentAccountGeneration,
  requireAccountGeneration,
} from './account-generation.ts';
import { api, apiVoid } from './api-client.ts';
import { keys, queryClient } from './query-client.ts';

const PAGE_SIZE = 50;

/** Snowflake ids sort numerically; compare as BigInt so long ids never lose precision. */
export const newer = (a: string, b: string) => BigInt(a) > BigInt(b);

export function useChannels() {
  return useQuery({
    queryKey: keys.channels,
    queryFn: fetchChannels,
  });
}

export async function fetchChannels(): Promise<Channel[]> {
  const generation = captureAccountGeneration();
  const items: Channel[] = [];
  let before: string | null = null;
  do {
    requireAccountGeneration(generation);
    const page: ChannelPage = await api(
      channelPageSchema,
      `/api/v1/users/@me/channels?limit=100${before ? `&before=${before}` : ''}`,
    );
    requireAccountGeneration(generation);
    items.push(...page.items);
    before = page.nextBefore;
  } while (before);
  return items.sort((a, b) => (newer(a.lastMessageId ?? a.id, b.lastMessageId ?? b.id) ? -1 : 1));
}

export function useChannel(channelId: string) {
  return useQuery({
    queryKey: keys.channel(channelId),
    queryFn: async () => {
      try {
        return await api(channelSchema, `/api/v1/channels/${channelId}`);
      } catch (error) {
        if (error instanceof DesktopError && error.code === 'NOT_FOUND') {
          historyGenerations.set(channelId, historyGeneration(channelId) + 1);
          await queryClient.cancelQueries({ queryKey: keys.messages(channelId) });
          queryClient.removeQueries({ queryKey: keys.messages(channelId) });
        }
        throw error;
      }
    },
  });
}

export function useOpenChannel() {
  return useMutation({
    onMutate: () => captureAccountGeneration(),
    mutationFn: (request: OpenChannelRequest) =>
      api(channelSchema, '/api/v1/users/@me/channels', { method: 'POST', body: request }),
    onSuccess: async (channel, _request, generation) => {
      if (generation === undefined) return;
      if (!isCurrentAccountGeneration(generation)) return;
      queryClient.setQueryData(keys.channel(channel.id), channel);
      await queryClient.invalidateQueries({ queryKey: keys.channels });
    },
  });
}

export function useChannelMembers(channelId: string) {
  const invalidate = (_result: unknown, _variables: unknown, generation: number | undefined) =>
    generation !== undefined && isCurrentAccountGeneration(generation)
      ? Promise.all([
          queryClient.invalidateQueries({ queryKey: keys.channel(channelId) }),
          queryClient.invalidateQueries({ queryKey: keys.channels }),
        ])
      : undefined;
  return {
    add: useMutation({
      onMutate: () => captureAccountGeneration(),
      mutationFn: (userId: string) =>
        apiVoid(`/api/v1/channels/${channelId}/members/${userId}`, { method: 'PUT', body: {} }),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      onMutate: () => captureAccountGeneration(),
      mutationFn: (userId: string) =>
        apiVoid(`/api/v1/channels/${channelId}/members/${userId}`, { method: 'DELETE' }),
      onSuccess: invalidate,
    }),
    rename: useMutation({
      onMutate: () => captureAccountGeneration(),
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
const historyGenerations = new Map<string, number>();
const lastVisibleRefresh = new Map<string, number>();
const validatedMessages = new Map<string, number>();
const historyGeneration = (channelId: string) => historyGenerations.get(channelId) ?? 0;

export function forgetChatCacheMetadata() {
  historyGenerations.clear();
  lastVisibleRefresh.clear();
  validatedMessages.clear();
}

/** Cancel old authorized views before a relationship change can expose cached content. */
export function resetMessageHistories() {
  for (const query of queryClient.getQueryCache().findAll({ queryKey: ['messages'] })) {
    const channelId = query.queryKey[1];
    if (typeof channelId === 'string')
      historyGenerations.set(channelId, historyGeneration(channelId) + 1);
  }
  validatedMessages.clear();
  lastVisibleRefresh.clear();
  return queryClient.resetQueries({ queryKey: ['messages'] });
}

/** Revalidate only the viewport, at most four message reads/second per active channel. */
export function refreshVisibleMessages(channelId: string, messageIds: readonly string[]) {
  const now = Date.now();
  if (now - (lastVisibleRefresh.get(channelId) ?? 0) < 5_000) return;
  const due = [...new Set(messageIds)]
    .filter((id) => now - (validatedMessages.get(`${channelId}:${id}`) ?? 0) >= 30_000)
    .slice(0, 20);
  if (!due.length) return;
  lastVisibleRefresh.set(channelId, now);
  for (const id of due) {
    const key = `${channelId}:${id}`;
    validatedMessages.set(key, now);
    void refreshMessage(channelId, id).catch(() => validatedMessages.delete(key));
  }
}

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
        if (!item.hidden && !message.hidden && item.version > message.version) return item;
        return message;
      }),
    }));
    const first = pages[0];
    if (!found && first) {
      // Gateway requests can resolve in any order. Insert anywhere inside the loaded range,
      // while ignoring older unloaded messages so a targeted edit cannot create a history gap.
      const target =
        pages.find((page) => {
          const oldest = page.items.at(-1);
          return !oldest || !newer(oldest.id, message.id);
        }) ?? (pages.at(-1)?.nextBefore === null ? pages.at(-1) : undefined);
      if (target)
        target.items = [...target.items, message].sort((a, b) => (newer(a.id, b.id) ? -1 : 1));
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
  const generation = captureAccountGeneration();
  const history = historyGeneration(channelId);
  try {
    const message = await api(messageSchema, `/api/v1/channels/${channelId}/messages/${messageId}`);
    if (isCurrentAccountGeneration(generation) && historyGeneration(channelId) === history)
      upsertMessage(channelId, message);
  } catch (error) {
    if (!isCurrentAccountGeneration(generation) || historyGeneration(channelId) !== history) return;
    if (error instanceof DesktopError && error.code === 'NOT_FOUND')
      removeMessage(channelId, messageId);
    else throw error;
  }
}

/**
 * Reconciles the newest page with the cache. When it no longer overlaps what is cached (a gap
 * after a long disconnect), older pages are dropped rather than shown with a hole.
 */
export async function reconcileNewest(channelId: string, resetHistory = false) {
  const generation = captureAccountGeneration();
  if (resetHistory) {
    historyGenerations.set(channelId, historyGeneration(channelId) + 1);
    await queryClient.cancelQueries({ queryKey: keys.messages(channelId) });
  }
  const history = historyGeneration(channelId);
  const data = queryClient.getQueryData<MessagesData>(keys.messages(channelId));
  if (!data) return;
  const fresh = await api(
    messagePageSchema,
    `/api/v1/channels/${channelId}/messages?limit=${PAGE_SIZE}`,
  );
  if (!isCurrentAccountGeneration(generation) || historyGeneration(channelId) !== history) return;
  queryClient.setQueryData<MessagesData>(keys.messages(channelId), (current) => {
    if (!current) return current;
    // Recovery cannot trust cached older pages: their edits/deletes may have been missed.
    // Resetting to a bounded page also avoids hundreds of requests for a 10k-row cache.
    if (resetHistory || fresh.nextBefore === null) return { pages: [fresh], pageParams: [null] };
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
      mutationFn: async ({
        messageId,
        content,
        expectedVersion,
      }: {
        messageId: string;
        content: string;
        expectedVersion: number;
      }) => {
        const generation = captureAccountGeneration();
        const history = historyGeneration(channelId);
        const message = await api(
          messageSchema,
          `/api/v1/channels/${channelId}/messages/${messageId}`,
          {
            method: 'PATCH',
            body: { content, expectedVersion },
          },
        );
        return { message, generation, history };
      },
      onSuccess: ({ message, generation, history }) => {
        if (isCurrentAccountGeneration(generation) && historyGeneration(channelId) === history)
          upsertMessage(channelId, message);
      },
    }),
    remove: useMutation({
      mutationFn: async (messageId: string) => {
        const generation = captureAccountGeneration();
        await apiVoid(`/api/v1/channels/${channelId}/messages/${messageId}`, { method: 'DELETE' });
        return generation;
      },
      onSuccess: (generation, messageId) => {
        if (isCurrentAccountGeneration(generation)) removeMessage(channelId, messageId);
      },
    }),
    react: useMutation({
      mutationFn: async ({
        messageId,
        emoji,
        add,
      }: {
        messageId: string;
        emoji: string;
        add: boolean;
      }) => {
        const generation = captureAccountGeneration();
        await apiVoid(
          `/api/v1/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`,
          add ? { method: 'PUT', body: {} } : { method: 'DELETE' },
        );
        return generation;
      },
      onSuccess: (generation, { messageId }) => {
        if (isCurrentAccountGeneration(generation)) return refreshMessage(channelId, messageId);
        return undefined;
      },
    }),
  };
}

export async function sendMessage(
  channelId: string,
  key: string,
  body: { content: string; replyToId?: string; attachmentIds?: string[] },
): Promise<Message> {
  const generation = captureAccountGeneration();
  const history = historyGeneration(channelId);
  const message = await api(messageSchema, `/api/v1/channels/${channelId}/messages`, {
    method: 'POST',
    body,
    headers: { 'idempotency-key': key },
  });
  if (isCurrentAccountGeneration(generation) && historyGeneration(channelId) === history)
    upsertMessage(channelId, message);
  return message;
}

/** Monotonic on the server; the cached channel list is updated optimistically. */
export async function markRead(channelId: string, messageId: string) {
  const generation = captureAccountGeneration();
  const state = await api(readStateSchema, `/api/v1/channels/${channelId}/read-state`, {
    method: 'PUT',
    body: { messageId },
  });
  if (!isCurrentAccountGeneration(generation)) return;
  const apply = (channel: Channel): Channel =>
    channel.id === channelId
      ? {
          ...channel,
          readState: {
            ...channel.readState,
            lastReadMessageId:
              state.lastReadMessageId &&
              (!channel.readState.lastReadMessageId ||
                newer(state.lastReadMessageId, channel.readState.lastReadMessageId))
                ? state.lastReadMessageId
                : channel.readState.lastReadMessageId,
          },
        }
      : channel;
  queryClient.setQueryData<Channel[]>(keys.channels, (channels) => channels?.map(apply));
  queryClient.setQueryData<Channel>(
    keys.channel(channelId),
    (channel) => channel && apply(channel),
  );
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: keys.channels }),
    queryClient.invalidateQueries({ queryKey: keys.channel(channelId) }),
  ]);
}
