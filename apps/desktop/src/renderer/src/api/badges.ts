import {
  type BadgePatch,
  badgeAwardListSchema,
  badgeAwardSchema,
  badgeDefinitionListSchema,
  badgeDefinitionSchema,
  type CreateBadgeRequest,
} from '@silvercord/protocol';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, apiVoid } from './api-client.ts';
import { keys, queryClient } from './query-client.ts';

export function useBadgeDefinitions(enabled = true) {
  return useQuery({
    queryKey: keys.badgeDefinitions,
    enabled,
    queryFn: async () => (await api(badgeDefinitionListSchema, '/api/v1/badges')).items,
  });
}

export function useOwnBadges() {
  return useQuery({
    queryKey: keys.ownBadges,
    queryFn: async () => (await api(badgeAwardListSchema, '/api/v1/users/@me/badges')).items,
  });
}

const refreshBadges = () => {
  void queryClient.invalidateQueries({ queryKey: keys.ownBadges });
  void queryClient.invalidateQueries({ queryKey: keys.badgeDefinitions });
  void queryClient.invalidateQueries({ queryKey: ['profile'] });
};

export function useSetBadgePins() {
  return useMutation({
    mutationFn: async (badgeIds: readonly string[]) =>
      (
        await api(badgeAwardListSchema, '/api/v1/users/@me/badges/pins', {
          method: 'PUT',
          body: { badgeIds },
        })
      ).items,
    onSuccess: (items) => {
      queryClient.setQueryData(keys.ownBadges, items);
      void queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}

/** Instance administrators only; the server enforces it. */
export function useBadgeAdmin() {
  const create = useMutation({
    mutationFn: (request: CreateBadgeRequest) =>
      api(badgeDefinitionSchema, '/api/v1/admin/badges', { method: 'POST', body: request }),
    onSuccess: refreshBadges,
  });
  const update = useMutation({
    mutationFn: ({ badgeId, patch }: { badgeId: string; patch: BadgePatch }) =>
      api(badgeDefinitionSchema, `/api/v1/admin/badges/${badgeId}`, {
        method: 'PATCH',
        body: patch,
      }),
    onSuccess: refreshBadges,
  });
  const award = useMutation({
    mutationFn: ({
      badgeId,
      username,
      reason,
    }: {
      badgeId: string;
      username: string;
      reason: string | null;
    }) =>
      api(badgeAwardSchema, `/api/v1/admin/badges/${badgeId}/awards`, {
        method: 'POST',
        body: { username, reason },
      }),
    onSuccess: refreshBadges,
  });
  const revoke = useMutation({
    mutationFn: ({ badgeId, userId }: { badgeId: string; userId: string }) =>
      apiVoid(`/api/v1/admin/badges/${badgeId}/awards/${userId}`, { method: 'DELETE' }),
    onSuccess: refreshBadges,
  });
  return { create, update, award, revoke };
}
