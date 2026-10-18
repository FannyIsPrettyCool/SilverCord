import { ALL_PERMISSIONS, CHANNEL_SCOPE, Permission } from './bits.ts';
import { computeGuildPermissions, type GuildInput, type MemberInput } from './compute.ts';

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
  if (actor.userId === target.userId) return bit === Permission.CHANGE_NICKNAME;
  return memberRank(guild, target) < memberRank(guild, actor);
}

/**
 * May `actor` add or remove `roleId` on `target` (possibly itself)? Besides rank, a non-owner may
 * only hand out roles whose bits it already holds: otherwise assigning a role created by the
 * owner would be an escalation path.
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
  return role !== undefined && (role.permissions & ~held) === 0n;
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

/**
 * Channel overwrite edits need MANAGE_ROLES in that channel and may only allow or deny bits the
 * actor itself has there (`actorChannelPermissions`).
 */
export function canEditOverwrite(
  guild: GuildInput,
  actor: MemberInput,
  actorChannelPermissions: bigint,
  change: { readonly allow: bigint; readonly deny: bigint },
): boolean {
  if (actor.userId === guild.ownerId) return ((change.allow | change.deny) & ~CHANNEL_SCOPE) === 0n;
  if ((actorChannelPermissions & Permission.MANAGE_ROLES) === 0n) return false;
  const touched = change.allow | change.deny;
  if ((touched & ~CHANNEL_SCOPE) !== 0n) return false;
  return (touched & ~actorChannelPermissions) === 0n;
}
