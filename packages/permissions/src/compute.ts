import {
  ALL_PERMISSIONS,
  CHANNEL_SCOPE,
  Permission,
  SEND_DEPENDENT,
  TIMEOUT_ALLOWED,
  VOICE_DEPENDENT,
} from './bits.ts';

export interface RoleInput {
  readonly id: string;
  readonly permissions: bigint;
  /** Unique within the guild; `@everyone` is 0. */
  readonly position: number;
}

export interface GuildInput {
  readonly ownerId: string;
  /** The `@everyone` role (same id as the guild). */
  readonly everyone: RoleInput;
  readonly roles: ReadonlyMap<string, RoleInput>;
}

export interface MemberInput {
  readonly userId: string;
  readonly roleIds: readonly string[];
  /** True while a timeout is active. */
  readonly timedOut?: boolean;
}

export interface Overwrite {
  readonly type: 'role' | 'member';
  readonly id: string;
  readonly allow: bigint;
  readonly deny: bigint;
}

export interface ChannelInput {
  readonly kind: 'text' | 'voice' | 'category' | 'announcement' | 'thread';
  readonly overwrites: readonly Overwrite[];
}

/** Guild-level permissions: owner and administrators get every bit. */
export function computeGuildPermissions(guild: GuildInput, member: MemberInput): bigint {
  if (member.userId === guild.ownerId) return ALL_PERMISSIONS;
  let permissions = guild.everyone.permissions;
  for (const roleId of member.roleIds) {
    const role = guild.roles.get(roleId);
    if (role) permissions |= role.permissions;
  }
  if ((permissions & Permission.ADMINISTRATOR) !== 0n) return ALL_PERMISSIONS;
  return member.timedOut ? permissions & TIMEOUT_ALLOWED : permissions;
}

/**
 * Channel permissions: base, then `@everyone`, aggregated role and member overwrites, then the
 * implicit rules (docs/spec/permissions.md).
 */
export function computeChannelPermissions(
  guild: GuildInput,
  member: MemberInput,
  channel: ChannelInput,
): bigint {
  const base = computeGuildPermissions(guild, member);
  const administrator = member.userId === guild.ownerId || (base & Permission.ADMINISTRATOR) !== 0n;
  if (administrator) return ALL_PERMISSIONS & CHANNEL_SCOPE;

  let permissions = base;
  const everyone = channel.overwrites.find(
    (overwrite) => overwrite.type === 'role' && overwrite.id === guild.everyone.id,
  );
  if (everyone) permissions = (permissions & ~everyone.deny) | everyone.allow;

  const memberRoles = new Set(member.roleIds);
  let roleAllow = 0n;
  let roleDeny = 0n;
  for (const overwrite of channel.overwrites) {
    if (overwrite.type !== 'role' || !memberRoles.has(overwrite.id)) continue;
    roleAllow |= overwrite.allow;
    roleDeny |= overwrite.deny;
  }
  permissions = (permissions & ~roleDeny) | roleAllow;

  const own = channel.overwrites.find(
    (overwrite) => overwrite.type === 'member' && overwrite.id === member.userId,
  );
  if (own) permissions = (permissions & ~own.deny) | own.allow;

  return applyImplicitRules(permissions, channel.kind, member.timedOut ?? false);
}

function applyImplicitRules(
  permissions: bigint,
  kind: ChannelInput['kind'],
  timedOut: boolean,
): bigint {
  let result = permissions & CHANNEL_SCOPE;
  if (timedOut) result &= TIMEOUT_ALLOWED;
  if ((result & Permission.VIEW_CHANNEL) === 0n) return 0n;
  if ((result & Permission.SEND_MESSAGES) === 0n) result &= ~SEND_DEPENDENT;
  if (kind === 'voice' && (result & Permission.CONNECT) === 0n) result &= ~VOICE_DEPENDENT;
  return result;
}
