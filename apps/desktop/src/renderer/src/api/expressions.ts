import {
  type Emote,
  emoteSchema,
  expressionLookupSchema,
  guildExpressionsSchema,
  LOOKUP_MAX_IDS,
  type Sticker,
  stickerSchema,
  usableExpressionsSchema,
} from '@silvercord/protocol';
import { useMutation, useQuery } from '@tanstack/react-query';
import { captureAccountGeneration, isCurrentAccountGeneration } from './account-generation.ts';
import { api, apiVoid } from './api-client.ts';
import { keys, queryClient } from './query-client.ts';

export function useUsableExpressions() {
  return useQuery({
    queryKey: keys.usableExpressions,
    queryFn: () => api(usableExpressionsSchema, '/api/v1/users/@me/expressions'),
    staleTime: 60_000,
  });
}

export function useGuildExpressions(guildId: string) {
  return useQuery({
    queryKey: keys.guildExpressions(guildId),
    queryFn: () => api(guildExpressionsSchema, `/api/v1/guilds/${guildId}/expressions`),
  });
}

/*
 * Rendering lookups for emotes and stickers found in messages, batched like profile
 * summaries; deleted ones resolve to null and render as their fallback.
 */
type Kind = 'emote' | 'sticker';
const pending: Record<Kind, Map<string, ((value: Emote | Sticker | null) => void)[]>> = {
  emote: new Map(),
  sticker: new Map(),
};
let timer: ReturnType<typeof setTimeout> | undefined;

async function flush() {
  timer = undefined;
  const emotes = pending.emote;
  const stickers = pending.sticker;
  pending.emote = new Map();
  pending.sticker = new Map();
  const emoteIds = [...emotes.keys()];
  const stickerIds = [...stickers.keys()];
  for (
    let start = 0;
    start < Math.max(emoteIds.length, stickerIds.length);
    start += LOOKUP_MAX_IDS
  ) {
    const e = emoteIds.slice(start, start + LOOKUP_MAX_IDS);
    const s = stickerIds.slice(start, start + LOOKUP_MAX_IDS);
    const query = new URLSearchParams();
    if (e.length) query.set('emoteIds', e.join(','));
    if (s.length) query.set('stickerIds', s.join(','));
    const result = await api(expressionLookupSchema, `/api/v1/expressions/lookup?${query}`).catch(
      () => ({ emotes: [], stickers: [] }),
    );
    const foundEmotes = new Map(result.emotes.map((item) => [item.id, item]));
    const foundStickers = new Map(result.stickers.map((item) => [item.id, item]));
    for (const id of e) for (const done of emotes.get(id) ?? []) done(foundEmotes.get(id) ?? null);
    for (const id of s)
      for (const done of stickers.get(id) ?? []) done(foundStickers.get(id) ?? null);
  }
}

function lookup(kind: Kind, id: string): Promise<Emote | Sticker | null> {
  return new Promise((resolve) => {
    const map = pending[kind];
    map.set(id, [...(map.get(id) ?? []), resolve]);
    if (timer === undefined) timer = setTimeout(() => void flush(), 8);
  });
}

export function useEmote(id: string) {
  return useQuery({
    queryKey: keys.emote(id),
    queryFn: async () => (await lookup('emote', id)) as Emote | null,
    staleTime: 5 * 60_000,
  });
}

export function useSticker(id: string) {
  return useQuery({
    queryKey: keys.sticker(id),
    queryFn: async () => (await lookup('sticker', id)) as Sticker | null,
    staleTime: 5 * 60_000,
  });
}

const refreshGuild = (guildId: string, generation: number | undefined) => {
  if (generation === undefined || !isCurrentAccountGeneration(generation)) return;
  void queryClient.invalidateQueries({ queryKey: keys.guildExpressions(guildId) });
  void queryClient.invalidateQueries({ queryKey: keys.usableExpressions });
};

/** MANAGE_EMOJIS actions; the server checks the permission again. */
export function useExpressionAdmin(guildId: string) {
  const base = `/api/v1/guilds/${guildId}`;
  const createEmote = useMutation({
    onMutate: () => captureAccountGeneration(),
    mutationFn: (input: { name: string; uploadId: string }) =>
      api(emoteSchema, `${base}/emotes`, { method: 'POST', body: input }),
    onSuccess: (_value, _input, generation) => refreshGuild(guildId, generation),
  });
  const renameEmote = useMutation({
    onMutate: () => captureAccountGeneration(),
    mutationFn: ({ emoteId, name }: { emoteId: string; name: string }) =>
      api(emoteSchema, `${base}/emotes/${emoteId}`, { method: 'PATCH', body: { name } }),
    onSuccess: (emote, _input, generation) => {
      if (generation === undefined || !isCurrentAccountGeneration(generation)) return;
      queryClient.setQueryData(keys.emote(emote.id), emote);
      refreshGuild(guildId, generation);
    },
  });
  const deleteEmote = useMutation({
    onMutate: () => captureAccountGeneration(),
    mutationFn: (emoteId: string) => apiVoid(`${base}/emotes/${emoteId}`, { method: 'DELETE' }),
    onSuccess: (_value, emoteId, generation) => {
      if (generation === undefined || !isCurrentAccountGeneration(generation)) return;
      queryClient.setQueryData(keys.emote(emoteId), null);
      refreshGuild(guildId, generation);
    },
  });
  const createSticker = useMutation({
    onMutate: () => captureAccountGeneration(),
    mutationFn: (input: {
      name: string;
      description: string;
      relatedEmoji: string | null;
      uploadId: string;
    }) => api(stickerSchema, `${base}/stickers`, { method: 'POST', body: input }),
    onSuccess: (_value, _input, generation) => refreshGuild(guildId, generation),
  });
  const deleteSticker = useMutation({
    onMutate: () => captureAccountGeneration(),
    mutationFn: (stickerId: string) =>
      apiVoid(`${base}/stickers/${stickerId}`, { method: 'DELETE' }),
    onSuccess: (_value, stickerId, generation) => {
      if (generation === undefined || !isCurrentAccountGeneration(generation)) return;
      queryClient.setQueryData(keys.sticker(stickerId), null);
      refreshGuild(guildId, generation);
    },
  });
  return { createEmote, renameEmote, deleteEmote, createSticker, deleteSticker };
}
