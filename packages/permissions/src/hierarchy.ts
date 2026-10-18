import { ALL_PERMISSIONS, CHANNEL_SCOPE, Permission } from './bits.ts';
import {
  type ChannelInput,
  computeChannelPermissions,
  computeGuildPermissions,
  type GuildInput,
  type MemberInput,
  type Overwrite,
} from './compute.ts';

/** Highest role position of a member; the owner outranks every role. */
export function memberRank(guild: GuildInput, member: MemberInput): number {
  if (member.userId === guild.ownerId) return Number.POSITIVE_INFINITY;
  let rank = 0;
  for (const roleId of member.roleIds) {
    const role = guild.roles.get(roleId);
    if (role && role.position > rank) rank = role.position;
  }
  return rank;
}

function holds(guild: GuildInput, actor: MemberInput, bit: bigint): boolean {
  return (computeGuildPermissions(guild, actor) & bit) === bit;
}

/** May `actor` edit, delete, assign or unassign `roleId`? `@everyone` is never manageable. */
export function canManageRole(guild: GuildInput, actor: MemberInput, roleId: string): boolean {
  if (roleId === guild.everyone.id) return false;
  const role = guild.roles.get(roleId);
  if (!role) return false;
  if (!holds(guild, actor, Permission.MANAGE_ROLES)) return false;
  return role.position < memberRank(guild, actor);
}

/**
 * May `actor` use a member-targeted action needing `bit` (kick, ban, timeout, nickname, role
 * assignment) on `target`? Nobody acts on the owner or (except nicknames) on themselves.
 */
export function canActOn(
  guild: GuildInput,
  actor: MemberInput,
  target: MemberInput,
  bit: bigint,
): boolean {
  if (target.userId === guild.ownerId) return false;
  if (!holds(guild, actor, bit)) return false;
  // Administrators bypass timeout masks, so applying a timeout would claim a restriction that
  // has no effect. Their administrator role must be removed before they can be timed out.
  if ((bit & Permission.MODERATE_MEMBERS) !== 0n && holds(guild, target, Permission.ADMINISTRATOR))
    return false;
  if (actor.userId === target.userId) return bit === Permission.CHANGE_NICKNAME;
  return memberRank(guild, target) < memberRank(guild, actor);
}

/**
 * May `actor` add or remove `roleId` on `target` (possibly itself)? Besides rank, a non-owner may
 * only hand out roles whose bits it already holds. Administrator-role assignment changes are
 * owner-only, including when the actor is another administrator.
 */
export function canAssignRole(
  guild: GuildInput,
  actor: MemberInput,
  target: MemberInput,
  roleId: string,
): boolean {
  if (!canManageRole(guild, actor, roleId)) return false;
  if (actor.userId !== target.userId && !canActOn(guild, actor, target, Permission.MANAGE_ROLES))
    return false;
  if (actor.userId === guild.ownerId) return true;
  const role = guild.roles.get(roleId);
  const held = computeGuildPermissions(guild, actor);
  return (
    role !== undefined &&
    (role.permissions & Permission.ADMINISTRATOR) === 0n &&
    (role.permissions & ~held) === 0n
  );
}

export interface RoleChange {
  readonly roleId: string | null;
  readonly permissions?: bigint;
  readonly position?: number;
}

/**
 * No escalation through role edits: a non-owner may only grant bits it holds, never
 * ADMINISTRATOR, and may not place a role at or above its own rank. `roleId: null` creates.
 */
export function canEditRole(guild: GuildInput, actor: MemberInput, change: RoleChange): boolean {
  const owner = actor.userId === guild.ownerId;
  if (change.roleId === guild.everyone.id) {
    if (change.position !== undefined && change.position !== 0) return false;
    if (!holds(guild, actor, Permission.MANAGE_ROLES)) return false;
  } else if (change.roleId !== null) {
    if (!canManageRole(guild, actor, change.roleId)) return false;
  } else if (!holds(guild, actor, Permission.MANAGE_ROLES)) {
    return false;
  }
  if (owner) return true;
  const rank = memberRank(guild, actor);
  if (
    change.position !== undefined &&
    change.roleId !== guild.everyone.id &&
    change.position >= rank
  )
    return false;
  if (change.permissions !== undefined) {
    const held = computeGuildPermissions(guild, actor);
    const current =
      change.roleId === null
        ? 0n
        : change.roleId === guild.everyone.id
          ? guild.everyone.permissions
          : (guild.roles.get(change.roleId)?.permissions ?? 0n);
    const added = change.permissions & ~current;
    if ((added & ~held) !== 0n) return false;
    if ((added & Permission.ADMINISTRATOR) !== 0n) return false;
    if ((change.permissions & ~ALL_PERMISSIONS) !== 0n) return false;
  }
  return true;
}

export type OverwriteTarget = Pick<Overwrite, 'type' | 'id'>;
export type OverwriteValue = Pick<Overwrite, 'allow' | 'deny'>;

/**
 * Authorizes a replacement or deletion (`replacement: null`) against the complete current
 * channel. Removed denies count as changes too: clearing one may restore denied permissions.
 * No caller-supplied held bits or partial overwrite snapshot can authorize the operation.
 */
export function canEditOverwrite(
  guild: GuildInput,
  actor: MemberInput,
  channel: ChannelInput,
  target: OverwriteTarget,
  replacement: OverwriteValue | null,
): boolean {
  if (target.type === 'role' && target.id !== guild.everyone.id && !guild.roles.has(target.id))
    return false;
  const allow = replacement?.allow ?? 0n;
  const deny = replacement?.deny ?? 0n;
  if (((allow | deny) & ~CHANNEL_SCOPE) !== 0n) return false;
  if (actor.userId === guild.ownerId) return true;
  const held = computeChannelPermissions(guild, actor, channel);
  if ((held & Permission.MANAGE_ROLES) === 0n) return false;

  const matches = (overwrite: Overwrite) =>
    overwrite.type === target.type && overwrite.id === target.id;
  const previous = channel.overwrites.find(matches);
  const touched = ((previous?.allow ?? 0n) ^ allow) | ((previous?.deny ?? 0n) ^ deny);
  if ((touched & ~held) !== 0n) return false;
  const overwrites = channel.overwrites.filter((overwrite) => !matches(overwrite));
  if (replacement) overwrites.push({ ...target, ...replacement });
  const after = computeChannelPermissions(guild, actor, { ...channel, overwrites });
  return (after & ~held) === 0n;
}
