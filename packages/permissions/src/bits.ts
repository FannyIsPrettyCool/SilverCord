/**
 * Permission bits (docs/spec/permissions.md). Positions are stored data: append only.
 */
export const Permission = {
  VIEW_CHANNEL: 1n << 0n,
  SEND_MESSAGES: 1n << 1n,
  SEND_MESSAGES_IN_THREADS: 1n << 2n,
  CREATE_THREADS: 1n << 3n,
  EMBED_LINKS: 1n << 4n,
  ATTACH_FILES: 1n << 5n,
  ADD_REACTIONS: 1n << 6n,
  USE_EXTERNAL_EMOJIS: 1n << 7n,
  MENTION_EVERYONE: 1n << 8n,
  READ_MESSAGE_HISTORY: 1n << 9n,
  MANAGE_MESSAGES: 1n << 10n,
  MANAGE_THREADS: 1n << 11n,
  CONNECT: 1n << 12n,
  SPEAK: 1n << 13n,
  VIDEO: 1n << 14n,
  STREAM: 1n << 15n,
  USE_VAD: 1n << 16n,
  PRIORITY_SPEAKER: 1n << 17n,
  MUTE_MEMBERS: 1n << 18n,
  DEAFEN_MEMBERS: 1n << 19n,
  MOVE_MEMBERS: 1n << 20n,
  CREATE_INVITE: 1n << 21n,
  CHANGE_NICKNAME: 1n << 22n,
  MANAGE_NICKNAMES: 1n << 23n,
  KICK_MEMBERS: 1n << 24n,
  BAN_MEMBERS: 1n << 25n,
  MODERATE_MEMBERS: 1n << 26n,
  MANAGE_CHANNELS: 1n << 27n,
  MANAGE_ROLES: 1n << 28n,
  MANAGE_EMOJIS: 1n << 29n,
  VIEW_AUDIT_LOG: 1n << 30n,
  MANAGE_GUILD: 1n << 31n,
  ADMINISTRATOR: 1n << 32n,
} as const;

export type PermissionName = keyof typeof Permission;

export const PERMISSION_NAMES = Object.keys(Permission) as PermissionName[];

/** Every defined bit. */
export const ALL_PERMISSIONS: bigint = Object.values(Permission).reduce(
  (all, bit) => all | bit,
  0n,
);

const bits = (...names: PermissionName[]) =>
  names.reduce((mask, name) => mask | Permission[name], 0n);

/** Bits that channel overwrites may change and channel results may contain. */
export const CHANNEL_SCOPE: bigint = bits(
  'VIEW_CHANNEL',
  'SEND_MESSAGES',
  'SEND_MESSAGES_IN_THREADS',
  'CREATE_THREADS',
  'EMBED_LINKS',
  'ATTACH_FILES',
  'ADD_REACTIONS',
  'USE_EXTERNAL_EMOJIS',
  'MENTION_EVERYONE',
  'READ_MESSAGE_HISTORY',
  'MANAGE_MESSAGES',
  'MANAGE_THREADS',
  'CONNECT',
  'SPEAK',
  'VIDEO',
  'STREAM',
  'USE_VAD',
  'PRIORITY_SPEAKER',
  'MUTE_MEMBERS',
  'DEAFEN_MEMBERS',
  'MOVE_MEMBERS',
  'CREATE_INVITE',
  'MANAGE_CHANNELS',
  'MANAGE_ROLES',
);

/** Cleared when SEND_MESSAGES is missing. */
export const SEND_DEPENDENT: bigint = bits('MENTION_EVERYONE', 'ATTACH_FILES', 'EMBED_LINKS');

/** Cleared in voice channels when CONNECT is missing. */
export const VOICE_DEPENDENT: bigint = bits(
  'SPEAK',
  'VIDEO',
  'STREAM',
  'USE_VAD',
  'PRIORITY_SPEAKER',
  'MUTE_MEMBERS',
  'DEAFEN_MEMBERS',
  'MOVE_MEMBERS',
);

/** What a timed-out member keeps. */
export const TIMEOUT_ALLOWED: bigint = bits('VIEW_CHANNEL', 'READ_MESSAGE_HISTORY');

export const DEFAULT_EVERYONE_PERMISSIONS: bigint = bits(
  'VIEW_CHANNEL',
  'SEND_MESSAGES',
  'SEND_MESSAGES_IN_THREADS',
  'CREATE_THREADS',
  'EMBED_LINKS',
  'ATTACH_FILES',
  'ADD_REACTIONS',
  'USE_EXTERNAL_EMOJIS',
  'READ_MESSAGE_HISTORY',
  'CONNECT',
  'SPEAK',
  'VIDEO',
  'STREAM',
  'USE_VAD',
  'CREATE_INVITE',
  'CHANGE_NICKNAME',
);

/** What a member of a DM or group may do: membership is the whole access model there. */
export const DIRECT_MESSAGE_PERMISSIONS: bigint = bits(
  'VIEW_CHANNEL',
  'SEND_MESSAGES',
  'EMBED_LINKS',
  'ATTACH_FILES',
  'ADD_REACTIONS',
  'USE_EXTERNAL_EMOJIS',
  'READ_MESSAGE_HISTORY',
  'CONNECT',
  'SPEAK',
  'VIDEO',
  'STREAM',
  'USE_VAD',
);

export function has(permissions: bigint, required: bigint): boolean {
  return (permissions & required) === required;
}

/** Decimal wire form; rejects anything outside the defined bits. */
export function parsePermissions(value: string): bigint {
  if (!/^\d{1,20}$/.test(value)) throw new RangeError('invalid permission bitfield');
  const parsed = BigInt(value);
  if ((parsed & ~ALL_PERMISSIONS) !== 0n) throw new RangeError('unknown permission bits');
  return parsed;
}

export function serializePermissions(value: bigint): string {
  return value.toString();
}
