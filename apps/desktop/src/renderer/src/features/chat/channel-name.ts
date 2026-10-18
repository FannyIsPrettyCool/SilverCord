import type { Channel, PublicUser } from '@silvercord/protocol';
import { displayName } from '../presence/Avatar.tsx';

/** The other members, in server order, without the viewer. */
export function peers(channel: Channel, selfId: string | undefined): PublicUser[] {
  return channel.members.filter((member) => member.id !== selfId);
}

/** DM: the peer's name. Group: its name, else member names (data, not invented copy). */
export function channelTitle(channel: Channel, selfId: string | undefined): string {
  if (channel.type === 'group_dm' && channel.name) return channel.name;
  const names = peers(channel, selfId).map(displayName);
  return names.length > 0 ? names.join(', ') : '…';
}
