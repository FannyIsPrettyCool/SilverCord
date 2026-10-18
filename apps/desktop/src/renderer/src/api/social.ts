import {
  type RelationshipKind,
  relationshipPageSchema,
  relationshipViewSchema,
  type SocialPrivacy,
  socialPrivacySchema,
} from '@silvercord/protocol';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, apiVoid } from './api-client.ts';
import { keys, queryClient } from './query-client.ts';

const ROOT = '/api/v1/users/@me';

/** One page per kind is plenty for a private community; the server caps pages at 100. */
export function useRelationships(kind: RelationshipKind) {
  return useQuery({
    queryKey: keys.relationships(kind),
    queryFn: async () =>
      (await api(relationshipPageSchema, `${ROOT}/relationships?kind=${kind}&limit=100`)).items,
  });
}

const refresh = () => queryClient.invalidateQueries({ queryKey: keys.relationships() });

export function useSendFriendRequest() {
  return useMutation({
    mutationFn: (username: string) =>
      api(relationshipViewSchema, `${ROOT}/relationships`, {
        method: 'POST',
        body: { username },
      }),
    onSuccess: refresh,
  });
}

export function useRelationshipAction() {
  return useMutation({
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
    onSuccess: async () => {
      await refresh();
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
    mutationFn: (patch: Partial<Omit<SocialPrivacy, 'version'>>) =>
      api(socialPrivacySchema, `${ROOT}/privacy`, { method: 'PATCH', body: patch }),
    onSuccess: (privacy) => queryClient.setQueryData(keys.privacy, privacy),
  });
}
