import {
  type RelationshipKind,
  type RelationshipPage,
  relationshipPageSchema,
  relationshipViewSchema,
  type SocialPrivacy,
  socialPrivacySchema,
} from '@silvercord/protocol';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  captureAccountGeneration,
  isCurrentAccountGeneration,
  requireAccountGeneration,
} from './account-generation.ts';
import { api, apiVoid } from './api-client.ts';
import { keys, queryClient } from './query-client.ts';

const ROOT = '/api/v1/users/@me';

/** A community can outgrow a single page; never silently hide older relationships. */
export async function fetchRelationships(kind: RelationshipKind) {
  const generation = captureAccountGeneration();
  const items: RelationshipPage['items'] = [];
  let before: string | null = null;
  do {
    requireAccountGeneration(generation);
    const page: RelationshipPage = await api(
      relationshipPageSchema,
      `${ROOT}/relationships?kind=${kind}&limit=100${before ? `&before=${before}` : ''}`,
    );
    requireAccountGeneration(generation);
    items.push(...page.items);
    before = page.nextBefore;
  } while (before);
  return items;
}

export function useRelationships(kind: RelationshipKind) {
  return useQuery({
    queryKey: keys.relationships(kind),
    queryFn: () => fetchRelationships(kind),
  });
}

const refresh = () => queryClient.invalidateQueries({ queryKey: keys.relationships() });

export function useSendFriendRequest() {
  return useMutation({
    onMutate: () => captureAccountGeneration(),
    mutationFn: (username: string) =>
      api(relationshipViewSchema, `${ROOT}/relationships`, {
        method: 'POST',
        body: { username },
      }),
    onSuccess: (_value, _request, generation) =>
      generation !== undefined && isCurrentAccountGeneration(generation) ? refresh() : undefined,
  });
}

export function useRelationshipAction() {
  return useMutation({
    onMutate: () => captureAccountGeneration(),
    mutationFn: async ({
      action,
      userId,
    }: {
      action: 'accept' | 'remove' | 'block' | 'unblock';
      userId: string;
    }) => {
      if (action === 'accept')
        return void (await api(relationshipViewSchema, `${ROOT}/relationships/${userId}/accept`, {
          method: 'PUT',
          body: {},
        }));
      if (action === 'remove')
        return apiVoid(`${ROOT}/relationships/${userId}`, { method: 'DELETE' });
      return apiVoid(`${ROOT}/blocks/${userId}`, {
        method: action === 'block' ? 'PUT' : 'DELETE',
        ...(action === 'block' ? { body: {} } : {}),
      });
    },
    onSuccess: async (_value, _request, generation) => {
      if (generation === undefined || !isCurrentAccountGeneration(generation)) return;
      await refresh();
      if (!isCurrentAccountGeneration(generation)) return;
      await queryClient.invalidateQueries({ queryKey: keys.channels });
    },
  });
}

export function usePrivacy() {
  return useQuery({
    queryKey: keys.privacy,
    queryFn: () => api(socialPrivacySchema, `${ROOT}/privacy`),
  });
}

export function useUpdatePrivacy() {
  return useMutation({
    onMutate: () => captureAccountGeneration(),
    mutationFn: (patch: Partial<Omit<SocialPrivacy, 'version'>>) =>
      api(socialPrivacySchema, `${ROOT}/privacy`, { method: 'PATCH', body: patch }),
    onSuccess: (privacy, _patch, generation) => {
      if (generation !== undefined && isCurrentAccountGeneration(generation))
        queryClient.setQueryData(keys.privacy, privacy);
    },
  });
}
