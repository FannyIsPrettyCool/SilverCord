import type { GuildChannel } from '@silvercord/protocol';
import { describe, expect, it } from 'vitest';
import { guildInitials, orderedGuildChannels } from './guild-state.ts';

const channel = (
  id: string,
  position: number,
  parentId: string | null = null,
  type: GuildChannel['type'] = 'guild_text',
): GuildChannel => ({
  id,
  position,
  parentId,
  type,
  guildId: '1',
  name: id,
  topic: null,
  archived: false,
  version: 1,
  lastMessageId: null,
  permissions: '1',
  createdAt: '2026-10-18T00:00:00.000Z',
});

describe('guild navigation', () => {
  it('keeps children in category order without mutating the API list', () => {
    const input = [
      channel('a2', 1, 'a'),
      channel('b', 1),
      channel('a1', 0, 'a'),
      channel('a', 0, null, 'guild_category'),
    ];
    expect(orderedGuildChannels(input).map(({ id }) => id)).toEqual(['a', 'a1', 'a2', 'b']);
    expect(input[0]?.id).toBe('a2');
  });

  it('keeps children reachable when their category is hidden', () => {
    expect(orderedGuildChannels([channel('child', 0, 'hidden')]).map(({ id }) => id)).toEqual([
      'child',
    ]);
  });

  it('uses two complete Unicode initials and handles blank names', () => {
    expect(guildInitials('  Silver Cord community ')).toBe('SC');
    expect(guildInitials('🌸 friends')).toBe('🌸f');
    expect(guildInitials('')).toBe('');
  });
});
