import type { Channel, GuildChannel, PublicUser, ReadStateView } from '@silvercord/protocol';

/** Shared transcript/composer input; guild membership stays on the server. */
export interface ChatChannel {
  readonly id: string;
  readonly type: Channel['type'] | GuildChannel['type'];
  readonly members: PublicUser[];
  readonly readState: ReadStateView;
}
