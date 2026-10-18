import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSIONS,
  CHANNEL_SCOPE,
  DEFAULT_EVERYONE_PERMISSIONS,
  has,
  Permission,
  parsePermissions,
  SEND_DEPENDENT,
  VOICE_DEPENDENT,
} from './bits.ts';
import {
  type ChannelInput,
  computeChannelPermissions,
  computeGuildPermissions,
  type GuildInput,
  type MemberInput,
  type Overwrite,
  type RoleInput,
} from './compute.ts';
import {
  canActOn,
  canAssignRole,
  canEditOverwrite,
  canEditRole,
  canManageRole,
  memberRank,
} from './hierarchy.ts';

const GUILD_ID = 'guild';
const OWNER = 'owner';

const bitsArb = fc
  .bigInt({ min: 0n, max: ALL_PERMISSIONS })
  .map((value) => value & ALL_PERMISSIONS);
const channelBitsArb = bitsArb.map((value) => value & CHANNEL_SCOPE);

/** 1–6 roles with unique positions 1..n, plus `@everyone`. */
const guildArb = fc
  .tuple(bitsArb, fc.array(bitsArb, { minLength: 1, maxLength: 6 }))
  .chain(([everyone, rolePermissions]) =>
    fc
      .shuffledSubarray(
        rolePermissions.map((_, index) => index + 1),
        { minLength: rolePermissions.length, maxLength: rolePermissions.length },
      )
      .map((positions): GuildInput => {
        const roles = new Map<string, RoleInput>(
          rolePermissions.map((permissions, index) => [
            `r${index}`,
            { id: `r${index}`, permissions, position: positions[index] ?? index + 1 },
          ]),
        );
        return {
          ownerId: OWNER,
          everyone: { id: GUILD_ID, permissions: everyone, position: 0 },
          roles,
        };
      }),
  );

const memberArb = (guild: GuildInput) =>
  fc.record({
    userId: fc.constantFrom('u1', 'u2', 'u3'),
    roleIds: fc.subarray([...guild.roles.keys()]),
    timedOut: fc.boolean(),
  }) as fc.Arbitrary<MemberInput>;

const overwriteArb = (guild: GuildInput) =>
  fc.record({
    type: fc.constantFrom('role' as const, 'member' as const),
    id: fc.constantFrom(GUILD_ID, ...guild.roles.keys(), 'u1', 'u2', 'u3'),
    allow: channelBitsArb,
    deny: channelBitsArb,
  }) as fc.Arbitrary<Overwrite>;

const channelArb = (guild: GuildInput) =>
  fc.record({
    kind: fc.constantFrom('text' as const, 'voice' as const, 'announcement' as const),
    overwrites: fc.array(overwriteArb(guild), { maxLength: 6 }),
  }) as fc.Arbitrary<ChannelInput>;

const scenarioArb = guildArb.chain((guild) =>
  fc.tuple(fc.constant(guild), memberArb(guild), channelArb(guild)),
);

const subset = (a: bigint, b: bigint) => (a & ~b) === 0n;

describe('permission resolution', () => {
  it('gives the owner and administrators every bit, past any overwrite', () => {
    fc.assert(
      fc.property(scenarioArb, ([guild, member, channel]) => {
        const owner = { ...member, userId: OWNER };
        expect(computeGuildPermissions(guild, owner)).toBe(ALL_PERMISSIONS);
        expect(computeChannelPermissions(guild, owner, channel)).toBe(CHANNEL_SCOPE);
        const admin: GuildInput = {
          ...guild,
          everyone: { ...guild.everyone, permissions: Permission.ADMINISTRATOR },
        };
        expect(computeChannelPermissions(admin, member, channel)).toBe(CHANNEL_SCOPE);
      }),
    );
  });

  it('is monotonic in roles at guild level', () => {
    fc.assert(
      fc.property(scenarioArb, ([guild, member]) => {
        for (const roleId of guild.roles.keys()) {
          const more = { ...member, roleIds: [...new Set([...member.roleIds, roleId])] };
          expect(
            subset(computeGuildPermissions(guild, member), computeGuildPermissions(guild, more)),
          ).toBe(true);
        }
      }),
    );
  });

  it('never loses bits when an overwrite allows more, never gains when it denies more', () => {
    fc.assert(
      fc.property(
        scenarioArb,
        channelBitsArb,
        fc.nat(),
        ([guild, member, channel], extra, pick) => {
          if (channel.overwrites.length === 0) return;
          const index = pick % channel.overwrites.length;
          const tweak = (change: (overwrite: Overwrite) => Overwrite): ChannelInput => ({
            ...channel,
            overwrites: channel.overwrites.map((overwrite, at) =>
              at === index ? change(overwrite) : overwrite,
            ),
          });
          const before = computeChannelPermissions(guild, member, channel);
          const allowed = computeChannelPermissions(
            guild,
            member,
            tweak((overwrite) => ({
              ...overwrite,
              allow: overwrite.allow | extra,
              deny: overwrite.deny & ~extra,
            })),
          );
          const denied = computeChannelPermissions(
            guild,
            member,
            tweak((overwrite) => ({
              ...overwrite,
              deny: overwrite.deny | extra,
              allow: overwrite.allow & ~extra,
            })),
          );
          expect(subset(before, allowed)).toBe(true);
          expect(subset(denied, before)).toBe(true);
        },
      ),
    );
  });

  it('applies member over roles over everyone overwrites', () => {
    const plain = [
      Permission.ADD_REACTIONS,
      Permission.CREATE_INVITE,
      Permission.MANAGE_MESSAGES,
      Permission.READ_MESSAGE_HISTORY,
    ];
    fc.assert(
      fc.property(guildArb, fc.constantFrom(...plain), (guild, bit) => {
        const [roleId] = guild.roles.keys();
        if (!roleId) return;
        const member: MemberInput = { userId: 'u1', roleIds: [roleId] };
        const base = (overwrites: Overwrite[]): ChannelInput => ({ kind: 'text', overwrites });
        const view = Permission.VIEW_CHANNEL;
        // Roles beat @everyone.
        expect(
          has(
            computeChannelPermissions(
              guild,
              member,
              base([
                { type: 'role', id: GUILD_ID, allow: view, deny: bit },
                { type: 'role', id: roleId, allow: bit | view, deny: 0n },
              ]),
            ),
            bit,
          ) || computeGuildPermissions(guild, member) === ALL_PERMISSIONS,
        ).toBe(true);
        // The member beats roles, both ways.
        const allowedBack = computeChannelPermissions(
          guild,
          member,
          base([
            { type: 'role', id: roleId, allow: 0n, deny: bit },
            { type: 'member', id: 'u1', allow: bit | view, deny: 0n },
          ]),
        );
        expect(has(allowedBack, bit)).toBe(true);
        const deniedBack = computeChannelPermissions(
          guild,
          member,
          base([
            { type: 'role', id: roleId, allow: bit | view, deny: 0n },
            { type: 'member', id: 'u1', allow: view, deny: bit },
          ]),
        );
        expect(
          has(deniedBack, bit) && computeGuildPermissions(guild, member) !== ALL_PERMISSIONS,
        ).toBe(false);
      }),
    );
  });

  it('grants nothing without view, and strips send- and voice-dependent bits', () => {
    fc.assert(
      fc.property(scenarioArb, ([guild, member, channel]) => {
        const result = computeChannelPermissions(guild, member, channel);
        expect(subset(result, CHANNEL_SCOPE)).toBe(true);
        if (result !== 0n) expect(has(result, Permission.VIEW_CHANNEL)).toBe(true);
        if (!has(result, Permission.SEND_MESSAGES)) expect(result & SEND_DEPENDENT).toBe(0n);
        if (channel.kind === 'voice' && !has(result, Permission.CONNECT))
          expect(result & VOICE_DEPENDENT).toBe(0n);
      }),
    );
  });

  it('limits timed-out members to reading', () => {
    fc.assert(
      fc.property(scenarioArb, ([guild, member, channel]) => {
        const result = computeChannelPermissions(guild, { ...member, timedOut: true }, channel);
        if (computeGuildPermissions(guild, member) === ALL_PERMISSIONS) return;
        expect(subset(result, Permission.VIEW_CHANNEL | Permission.READ_MESSAGE_HISTORY)).toBe(
          true,
        );
      }),
    );
  });
});

describe('hierarchy', () => {
  it('never lets a non-owner manage a role at or above its rank, or @everyone', () => {
    fc.assert(
      fc.property(scenarioArb, ([guild, member]) => {
        const rank = memberRank(guild, member);
        expect(canManageRole(guild, member, GUILD_ID)).toBe(false);
        for (const role of guild.roles.values())
          if (role.position >= rank) expect(canManageRole(guild, member, role.id)).toBe(false);
      }),
    );
  });

  it('never acts on the owner or on higher-ranked members', () => {
    fc.assert(
      fc.property(
        guildArb.chain((guild) => fc.tuple(fc.constant(guild), memberArb(guild), memberArb(guild))),
        ([guild, actor, target]) => {
          if (actor.userId === target.userId) return;
          expect(
            canActOn(guild, actor, { ...target, userId: OWNER }, Permission.KICK_MEMBERS),
          ).toBe(false);
          if (memberRank(guild, target) >= memberRank(guild, actor))
            expect(canActOn(guild, actor, target, Permission.BAN_MEMBERS)).toBe(false);
        },
      ),
    );
  });

  type Operation =
    | { kind: 'edit'; role: number; permissions: bigint; position?: number }
    | { kind: 'create'; permissions: bigint; position: number }
    | { kind: 'assign'; role: number; target: 'u1' | 'u2' };

  const operationArb: fc.Arbitrary<Operation> = fc.oneof(
    fc
      .record({
        kind: fc.constant('edit' as const),
        role: fc.nat(8),
        permissions: bitsArb,
        position: fc.option(fc.integer({ min: 1, max: 9 }), { nil: undefined }),
      })
      .map(({ position, ...rest }) => (position === undefined ? rest : { ...rest, position })),
    fc.record({
      kind: fc.constant('create' as const),
      permissions: bitsArb,
      position: fc.integer({ min: 1, max: 9 }),
    }),
    fc.record({
      kind: fc.constant('assign' as const),
      role: fc.nat(8),
      target: fc.constantFrom('u1' as const, 'u2' as const),
    }),
  );

  it('admits no privilege escalation through any sequence of permitted edits', () => {
    fc.assert(
      fc.property(
        guildArb,
        fc.subarray(['r0', 'r1', 'r2', 'r3', 'r4', 'r5']),
        fc.array(operationArb, { maxLength: 12 }),
        (initial, actorRoles, operations) => {
          let guild = initial;
          const roleIds = new Map<string, string[]>([
            ['u1', actorRoles.filter((id) => guild.roles.has(id))],
            ['u2', []],
          ]);
          const member = (userId: string): MemberInput => ({
            userId,
            roleIds: roleIds.get(userId) ?? [],
          });
          const before = computeGuildPermissions(guild, member('u1'));
          let created = 0;
          for (const operation of operations) {
            const actor = member('u1');
            const ids = [...guild.roles.keys()];
            if (operation.kind === 'create') {
              if (
                !canEditRole(guild, actor, {
                  roleId: null,
                  permissions: operation.permissions,
                  position: operation.position,
                })
              )
                continue;
              const id = `new${created++}`;
              const roles = new Map(guild.roles);
              roles.set(id, { id, permissions: operation.permissions, position: 100 + created });
              guild = { ...guild, roles };
            } else if (operation.kind === 'edit') {
              const id = ids[operation.role % ids.length];
              if (!id) continue;
              const change = {
                roleId: id,
                permissions: operation.permissions,
                ...(operation.position === undefined ? {} : { position: operation.position }),
              };
              if (!canEditRole(guild, actor, change)) continue;
              const roles = new Map(guild.roles);
              const role = roles.get(id);
              if (role) roles.set(id, { ...role, permissions: operation.permissions });
              guild = { ...guild, roles };
            } else {
              const id = ids[operation.role % ids.length];
              if (!id || !canAssignRole(guild, actor, member(operation.target), id)) continue;
              roleIds.set(operation.target, [
                ...new Set([...(roleIds.get(operation.target) ?? []), id]),
              ]);
            }
          }
          expect(subset(computeGuildPermissions(guild, member('u1')), before)).toBe(true);
          expect(
            subset(
              computeGuildPermissions(guild, member('u2')),
              before |
                computeGuildPermissions(initial, member('u2')) |
                initial.everyone.permissions |
                guild.everyone.permissions,
            ),
          ).toBe(true);
        },
      ),
    );
  });

  it('only lets overwrites touch channel bits the actor holds there', () => {
    fc.assert(
      fc.property(
        guildArb,
        channelBitsArb,
        channelBitsArb,
        channelBitsArb,
        (guild, held, allow, deny) => {
          const actor: MemberInput = { userId: 'u1', roleIds: [] };
          const permitted = canEditOverwrite(guild, actor, held | Permission.MANAGE_ROLES, {
            allow,
            deny,
          });
          expect(permitted).toBe(((allow | deny) & ~(held | Permission.MANAGE_ROLES)) === 0n);
          expect(
            canEditOverwrite(guild, actor, held & ~Permission.MANAGE_ROLES, { allow, deny }),
          ).toBe(false);
        },
      ),
    );
  });
});

describe('wire form', () => {
  it('round-trips defined bits and rejects unknown ones', () => {
    expect(parsePermissions(DEFAULT_EVERYONE_PERMISSIONS.toString())).toBe(
      DEFAULT_EVERYONE_PERMISSIONS,
    );
    expect(() => parsePermissions((1n << 40n).toString())).toThrow(RangeError);
    expect(() => parsePermissions('-1')).toThrow(RangeError);
    expect(() => parsePermissions('1e3')).toThrow(RangeError);
  });
});
