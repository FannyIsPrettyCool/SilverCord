import {
  type CreateGuildRequest,
  type GuildChannelCreate,
  type GuildChannelPatch,
  type GuildPatch,
  guildChannelListSchema,
  guildChannelSchema,
  guildListSchema,
  guildSchema,
} from '@silvercord/protocol';
import { useMutation, useQuery } from '@tanstack/react-query';
import { captureAccountGeneration, isCurrentAccountGeneration } from './account-generation.ts';
import { api, apiVoid } from './api-client.ts';
import { keys, queryClient } from './query-client.ts';

export function useGuilds() {
  return useQuery({
    queryKey: keys.guilds,
    queryFn: () => api(guildListSchema, '/api/v1/users/@me/guilds'),
  });
}

export function useGuild(guildId: string) {
  return useQuery({
    queryKey: keys.guild(guildId),
    queryFn: () => api(guildSchema, `/api/v1/guilds/${guildId}`),
  });
}

export function useGuildChannels(guildId: string) {
  return useQuery({
    queryKey: keys.guildChannels(guildId),
    queryFn: () => api(guildChannelListSchema, `/api/v1/guilds/${guildId}/channels`),
  });
}

async function refreshGuild(guildId: string, generation: number | undefined) {
  if (generation === undefined || !isCurrentAccountGeneration(generation)) return;
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: keys.guilds }),
    queryClient.invalidateQueries({ queryKey: keys.guild(guildId) }),
    queryClient.invalidateQueries({ queryKey: keys.guildChannels(guildId) }),
  ]);
}

export function useCreateGuild() {
  return useMutation({
    onMutate: captureAccountGeneration,
    mutationFn: (body: CreateGuildRequest) =>
      api(guildSchema, '/api/v1/users/@me/guilds', { method: 'POST', body }),
    onSuccess: (guild, _body, generation) => refreshGuild(guild.id, generation),
  });
}

export function useGuildActions(guildId: string) {
  return {
    rename: useMutation({
      onMutate: captureAccountGeneration,
      mutationFn: (body: GuildPatch) =>
        api(guildSchema, `/api/v1/guilds/${guildId}`, { method: 'PATCH', body }),
      onSuccess: (_guild, _body, generation) => refreshGuild(guildId, generation),
    }),
    leave: useMutation({
      onMutate: captureAccountGeneration,
      mutationFn: () => apiVoid(`/api/v1/guilds/${guildId}/members/@me`, { method: 'DELETE' }),
      onSuccess: async (_result, _body, generation) => {
        if (generation === undefined || !isCurrentAccountGeneration(generation)) return;
        queryClient.removeQueries({ queryKey: keys.guild(guildId) });
        queryClient.removeQueries({ queryKey: keys.guildChannels(guildId) });
        await queryClient.invalidateQueries({ queryKey: keys.guilds });
      },
    }),
  };
}

export function useGuildChannelActions(guildId: string) {
  const path = `/api/v1/guilds/${guildId}/channels`;
  const invalidate = (_result: unknown, _body: unknown, generation: number | undefined) =>
    refreshGuild(guildId, generation);
  return {
    create: useMutation({
      onMutate: captureAccountGeneration,
      mutationFn: (body: GuildChannelCreate) =>
        api(guildChannelSchema, path, { method: 'POST', body }),
      onSuccess: invalidate,
    }),
    edit: useMutation({
      onMutate: captureAccountGeneration,
      mutationFn: ({ channelId, ...body }: GuildChannelPatch & { channelId: string }) =>
        api(guildChannelSchema, `${path}/${channelId}`, { method: 'PATCH', body }),
      onSuccess: invalidate,
    }),
  };
}
