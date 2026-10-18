import type { UserProfile, UserSummary } from '@silvercord/protocol';
import { create } from 'zustand';
import type { CardData } from './ProfileCard.tsx';

/** The one full-profile dialog the shell renders; any trigger can open it. */
export const useProfileView = create<{
  readonly userId: string | null;
  readonly guildId: string | undefined;
  open(userId: string, guildId?: string): void;
  close(): void;
}>()((set) => ({
  userId: null,
  guildId: undefined,
  open: (userId, guildId) => set({ userId, guildId }),
  close: () => set({ userId: null, guildId: undefined }),
}));

/** Card data from a full profile, else from the summary already cached for lists. */
export function cardFrom(
  user: CardData['user'],
  profile: UserProfile | undefined,
  summary: UserSummary | null | undefined,
): CardData {
  if (profile)
    return {
      user: {
        id: profile.userId,
        username: profile.username,
        displayName: profile.displayName,
      },
      avatar: profile.avatar,
      banner: profile.banner,
      accentColor: profile.accentColor,
      bannerColor: profile.bannerColor,
      themeColors: profile.themeColors,
      pronouns: profile.pronouns,
      bio: profile.bio,
      customStatus: profile.customStatus,
      memberSince: profile.memberSince,
      nickname: profile.guildMember?.nickname ?? null,
      badges: profile.badges,
    };
  return {
    user,
    avatar: summary?.avatar ?? null,
    accentColor: summary?.accentColor ?? null,
    bannerColor: null,
    themeColors: null,
    customStatus: summary?.customStatus,
    nickname: summary?.nickname ?? null,
  };
}
