import { QueryClient } from '@tanstack/react-query';
import { DesktopError } from '../desktop.ts';

/** Client errors are final: retrying a 403/404/409 only repeats the refusal. */
const FINAL = new Set([
  'VALIDATION_FAILED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'UNAUTHENTICATED',
  'PAYLOAD_TOO_LARGE',
]);

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      retry: (count, error) =>
        !(error instanceof DesktopError && FINAL.has(error.code)) && count < 3,
    },
    mutations: { retry: false },
  },
});

/** Query keys in one place so gateway invalidations and hooks always agree. */
export const keys = {
  relationships: (kind?: string) => (kind ? ['relationships', kind] : ['relationships']),
  privacy: ['privacy'],
  guilds: ['guilds'],
  guild: (guildId: string) => ['guild', guildId],
  guildChannels: (guildId?: string) => (guildId ? ['guild-channels', guildId] : ['guild-channels']),
  channels: ['channels'],
  channel: (channelId: string) => ['channel', channelId],
  messages: (channelId: string) => ['messages', channelId],
  presence: (userIds?: readonly string[]) =>
    userIds ? ['presence', [...userIds].sort().join(',')] : ['presence'],
  ownPresence: ['own-presence'],
  typing: (channelId: string) => ['typing', channelId],
  upload: (uploadId: string) => ['upload', uploadId],
  summary: (userId: string, guildId?: string) => ['summary', userId, guildId ?? ''],
  profile: (userId: string, guildId?: string) => ['profile', userId, guildId ?? ''],
  ownProfile: ['own-profile'],
  badgeDefinitions: ['badge-definitions'],
  ownBadges: ['own-badges'],
  ownActivity: ['own-activity'],
  activityGames: ['activity-games'],
  rpcApps: ['rpc-apps'],
  usableExpressions: ['usable-expressions'],
  guildExpressions: (guildId: string) => ['guild-expressions', guildId],
  emote: (emoteId: string) => ['emote', emoteId],
  sticker: (stickerId: string) => ['sticker', stickerId],
  guildProfile: (guildId: string) => ['guild-profile', guildId],
} as const;
