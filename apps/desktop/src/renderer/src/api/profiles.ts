import {
  type Crop,
  type CustomStatusRequest,
  type GuildMemberProfilePatch,
  guildMemberProfileSchema,
  type OwnProfile,
  ownProfileSchema,
  type ProfileMediaPurpose,
  type ProfilePatch,
  type ProfilePrivacy,
  type ProfileUpload,
  profileUploadSchema,
  SUMMARIES_MAX_IDS,
  type UserSummary,
  userProfileSchema,
  userSummariesSchema,
} from '@silvercord/protocol';
import { useMutation, useQuery } from '@tanstack/react-query';
import { captureAccountGeneration, isCurrentAccountGeneration } from './account-generation.ts';
import { api, apiVoid } from './api-client.ts';
import { sendChunks } from './media.ts';
import { keys, queryClient } from './query-client.ts';

/*
 * Card summaries are cached per user and context and fetched in batches: every avatar asks for
 * its own user, and requests made in the same tick share one GET /users/summaries.
 */
const BATCH_DELAY_MS = 8;
interface Pending {
  readonly resolve: (summary: UserSummary | null) => void;
  readonly reject: (error: unknown) => void;
}
const batches = new Map<string, Map<string, Pending[]>>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

async function flushBatch(context: string) {
  timers.delete(context);
  const batch = batches.get(context);
  batches.delete(context);
  if (!batch) return;
  const ids = [...batch.keys()];
  for (let start = 0; start < ids.length; start += SUMMARIES_MAX_IDS) {
    const slice = ids.slice(start, start + SUMMARIES_MAX_IDS);
    const query = new URLSearchParams({ userIds: slice.join(',') });
    if (context) query.set('guildId', context);
    try {
      const { items } = await api(userSummariesSchema, `/api/v1/users/summaries?${query}`);
      const byId = new Map(items.map((item) => [item.userId, item]));
      for (const id of slice)
        for (const waiter of batch.get(id) ?? []) waiter.resolve(byId.get(id) ?? null);
    } catch (error) {
      for (const id of slice) for (const waiter of batch.get(id) ?? []) waiter.reject(error);
    }
  }
}

function loadSummary(userId: string, guildId: string | undefined): Promise<UserSummary | null> {
  const context = guildId ?? '';
  return new Promise((resolve, reject) => {
    let batch = batches.get(context);
    if (!batch) {
      batch = new Map();
      batches.set(context, batch);
    }
    batch.set(userId, [...(batch.get(userId) ?? []), { resolve, reject }]);
    if (!timers.has(context))
      timers.set(
        context,
        setTimeout(() => void flushBatch(context), BATCH_DELAY_MS),
      );
  });
}

export function useSummary(userId: string, guildId?: string) {
  return useQuery({
    queryKey: keys.summary(userId, guildId),
    queryFn: () => loadSummary(userId, guildId),
    staleTime: 60_000,
  });
}

export function useProfile(userId: string | null, guildId?: string) {
  return useQuery({
    queryKey: keys.profile(userId ?? '', guildId),
    enabled: userId !== null,
    queryFn: () =>
      api(
        userProfileSchema,
        `/api/v1/users/${userId}/profile${guildId ? `?guildId=${guildId}` : ''}`,
      ),
  });
}

export function useOwnProfile() {
  return useQuery({
    queryKey: keys.ownProfile,
    queryFn: () => api(ownProfileSchema, '/api/v1/users/@me/profile'),
  });
}

/** Writes the own profile back into the caches it feeds. */
function storeOwn(own: OwnProfile, generation: number | undefined) {
  if (generation === undefined || !isCurrentAccountGeneration(generation)) return;
  queryClient.setQueryData(keys.ownProfile, own);
  void queryClient.invalidateQueries({ queryKey: ['summary', own.userId] });
  void queryClient.invalidateQueries({ queryKey: ['profile', own.userId] });
}

export function usePatchProfile() {
  return useMutation({
    onMutate: () => captureAccountGeneration(),
    mutationFn: (patch: ProfilePatch) =>
      api(ownProfileSchema, '/api/v1/users/@me/profile', { method: 'PATCH', body: patch }),
    onSuccess: (own, _patch, generation) => storeOwn(own, generation),
  });
}

export function useSetProfilePrivacy() {
  return useMutation({
    onMutate: () => captureAccountGeneration(),
    mutationFn: (privacy: ProfilePrivacy) =>
      api(ownProfileSchema, '/api/v1/users/@me/profile/privacy', { method: 'PUT', body: privacy }),
    onSuccess: (own, _privacy, generation) => storeOwn(own, generation),
  });
}

export function useSetCustomStatus() {
  return useMutation({
    mutationFn: (status: CustomStatusRequest | null) =>
      status
        ? apiVoid('/api/v1/users/@me/custom-status', { method: 'PUT', body: status })
        : apiVoid('/api/v1/users/@me/custom-status', { method: 'DELETE' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.ownProfile }),
  });
}

export function useGuildProfile(guildId: string) {
  return useQuery({
    queryKey: keys.guildProfile(guildId),
    queryFn: () => api(guildMemberProfileSchema, `/api/v1/guilds/${guildId}/members/@me/profile`),
  });
}

export function usePatchGuildProfile(guildId: string) {
  return useMutation({
    mutationFn: (patch: GuildMemberProfilePatch) =>
      api(guildMemberProfileSchema, `/api/v1/guilds/${guildId}/members/@me/profile`, {
        method: 'PATCH',
        body: patch,
      }),
    onSuccess: (profile) => {
      queryClient.setQueryData(keys.guildProfile(guildId), profile);
      void queryClient.invalidateQueries({ queryKey: ['summary'] });
      void queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}

const POLL_MS = 500;

/**
 * Uploads one avatar, banner or other profile image and waits until the server has produced
 * its cropped variants. The returned upload is `ready` (or `failed`) and not yet in use.
 */
export async function uploadProfileImage(input: {
  readonly file: File;
  readonly purpose: ProfileMediaPurpose;
  readonly crop?: Crop;
  readonly guildId?: string;
  readonly signal: AbortSignal;
  readonly onProgress?: (fraction: number) => void;
}): Promise<ProfileUpload> {
  const { signal } = input;
  const reserved = await api(profileUploadSchema, '/api/v1/uploads', {
    method: 'POST',
    body: {
      purpose: input.purpose,
      filename: input.file.name.slice(0, 128) || 'image',
      sizeBytes: input.file.size,
      ...(input.guildId ? { guildId: input.guildId } : {}),
    },
    signal,
  });
  await sendChunks(reserved, input.file, signal, (fraction) => input.onProgress?.(fraction));
  await api(profileUploadSchema, `/api/v1/uploads/${reserved.id}/complete`, {
    method: 'POST',
    body: input.crop ? { crop: input.crop } : {},
    signal,
  });
  for (;;) {
    const upload = await api(profileUploadSchema, `/api/v1/uploads/${reserved.id}`, { signal });
    if (upload.state !== 'processing' && upload.state !== 'uploading') return upload;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

/** PROFILE_CHANGED: drop every cached view of that user (all guild contexts). */
export function profileChanged(userId: string) {
  void queryClient.invalidateQueries({ queryKey: ['summary', userId] });
  void queryClient.invalidateQueries({ queryKey: ['profile', userId] });
  const own = queryClient.getQueryData<OwnProfile>(keys.ownProfile);
  if (own?.userId === userId) void queryClient.invalidateQueries({ queryKey: keys.ownProfile });
}
