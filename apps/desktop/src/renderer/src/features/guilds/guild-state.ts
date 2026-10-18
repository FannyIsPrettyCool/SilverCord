import type { GuildChannel } from '@silvercord/protocol';

/** Categories stay together; orphaned children remain reachable after visibility changes. */
export function orderedGuildChannels(channels: readonly GuildChannel[]): GuildChannel[] {
  const compare = (a: GuildChannel, b: GuildChannel) =>
    a.position - b.position || a.id.localeCompare(b.id);
  const categories = new Set(
    channels.filter((channel) => channel.type === 'guild_category').map((channel) => channel.id),
  );
  const roots = channels
    .filter((channel) => channel.parentId === null || !categories.has(channel.parentId))
    .sort(compare);
  return roots.flatMap((channel) => [
    channel,
    ...(channel.type === 'guild_category'
      ? channels.filter((child) => child.parentId === channel.id).sort(compare)
      : []),
  ]);
}

export function guildInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/u)
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? '')
    .join('');
}
