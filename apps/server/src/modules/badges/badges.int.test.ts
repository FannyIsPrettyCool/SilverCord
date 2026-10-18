import {
  badgeAwardListSchema,
  badgeDefinitionListSchema,
  badgeDefinitionSchema,
  ownProfileSchema,
  userProfileSchema,
} from '@silvercord/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, expectError, openRegistration, register } from '../../../test/auth-helpers.ts';
import { createTestApp, type TestApp } from '../../../test/test-app.ts';

type Account = Awaited<ReturnType<typeof register>>;
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

describe('badges', () => {
  let t: TestApp;
  let admin: Account;
  beforeAll(async () => {
    t = await createTestApp();
    await openRegistration(t);
    // The first account is the instance administrator (and the founder).
    admin = await register(t);
  });
  afterAll(() => t.close());

  const id = (account: Account) => account.tokens.user.id;
  const call = (actor: Account, method: Method, url: string, payload?: unknown) =>
    t.request({
      method,
      url: `/api/v1${url}`,
      headers: bearer(actor.tokens),
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  const own = async (actor: Account) =>
    badgeAwardListSchema.parse((await call(actor, 'GET', '/users/@me/badges')).json()).items;
  const keys = (items: Awaited<ReturnType<typeof own>>) => items.map((item) => item.badge.key);

  it('awards built-in rules: founder, early member and server owner', async () => {
    expect(keys(await own(admin))).toEqual(
      expect.arrayContaining(['founder', 'early_member', 'instance_admin']),
    );
    const member = await register(t);
    expect((await call(member, 'POST', '/users/@me/guilds', { name: 'Kiln' })).statusCode).toBe(
      201,
    );
    const items = await own(member);
    expect(keys(items)).toEqual(expect.arrayContaining(['early_member', 'server_owner']));
    expect(keys(items)).not.toContain('founder');
    expect(keys(items)).not.toContain('instance_admin');
    // Rarest first: legendary early member before uncommon server owner.
    expect(keys(items).indexOf('early_member')).toBeLessThan(keys(items).indexOf('server_owner'));
  });

  it('lets administrators create and award manual badges, and nobody else', async () => {
    const member = await register(t);
    const body = {
      name: 'Beta tester',
      description: 'Broke it first',
      rarity: 'epic',
      iconName: 'rocket',
    };
    expectError(await call(member, 'POST', '/admin/badges', body), 403, 'FORBIDDEN');
    const created = await call(admin, 'POST', '/admin/badges', body);
    expect(created.statusCode, created.body).toBe(201);
    const badge = badgeDefinitionSchema.parse(created.json());
    expect(badge).toMatchObject({
      key: null,
      name: 'Beta tester',
      icon: { kind: 'icon', name: 'rocket' },
    });

    const awarded = await call(admin, 'POST', `/admin/badges/${badge.id}/awards`, {
      username: member.account.username,
      reason: 'first crash report',
    });
    expect(awarded.statusCode, awarded.body).toBe(200);
    // Idempotent.
    expect(
      (
        await call(admin, 'POST', `/admin/badges/${badge.id}/awards`, {
          username: member.account.username,
        })
      ).statusCode,
    ).toBe(200);
    expect(keys(await own(member))).toContain(null);

    const definitions = badgeDefinitionListSchema.parse(
      (await call(member, 'GET', '/badges')).json(),
    );
    const founder = definitions.items.find((item) => item.key === 'founder');
    expect(founder).toBeDefined();
    expectError(
      await call(admin, 'POST', `/admin/badges/${founder?.id}/awards`, {
        username: member.account.username,
      }),
      403,
      'FORBIDDEN',
    );
    expectError(
      await call(admin, 'PATCH', `/admin/badges/${founder?.id}`, { name: 'Mine' }),
      403,
      'FORBIDDEN',
    );

    const viewer = await register(t);
    const profile = userProfileSchema.parse(
      (await call(viewer, 'GET', `/users/${id(member)}/profile`)).json(),
    );
    expect(profile.badges?.some((award) => award.badge.id === badge.id)).toBe(true);

    expect(
      (await call(admin, 'DELETE', `/admin/badges/${badge.id}/awards/${id(member)}`)).statusCode,
    ).toBe(204);
    expect((await own(member)).some((award) => award.badge.id === badge.id)).toBe(false);

    await call(admin, 'PATCH', `/admin/badges/${badge.id}`, { retired: true });
    expectError(
      await call(admin, 'POST', `/admin/badges/${badge.id}/awards`, {
        username: member.account.username,
      }),
      409,
      'CONFLICT',
    );
  });

  it('pins held badges in order and hides badges by audience', async () => {
    const member = await register(t);
    await call(member, 'POST', '/users/@me/guilds', { name: 'Pins' });
    const held = await own(member);
    const [first, second] = held;
    if (!first || !second) throw new Error('expected two badges');
    const pinned = badgeAwardListSchema.parse(
      (
        await call(member, 'PUT', '/users/@me/badges/pins', {
          badgeIds: [second.badge.id, first.badge.id],
        })
      ).json(),
    ).items;
    expect(pinned.slice(0, 2).map((award) => [award.badge.id, award.pin])).toEqual([
      [second.badge.id, 0],
      [first.badge.id, 1],
    ]);
    const others = (await call(admin, 'GET', '/badges')).json() as { items: { id: string }[] };
    const notHeld = others.items.find((item) => !held.some((award) => award.badge.id === item.id));
    expectError(
      await call(member, 'PUT', '/users/@me/badges/pins', { badgeIds: [notHeld?.id] }),
      404,
      'NOT_FOUND',
    );

    const stranger = await register(t);
    const privacy = ownProfileSchema.parse(
      (await call(member, 'GET', '/users/@me/profile')).json(),
    ).privacy;
    await call(member, 'PUT', '/users/@me/profile/privacy', { ...privacy, badges: 'only_me' });
    const view = userProfileSchema.parse(
      (await call(stranger, 'GET', `/users/${id(member)}/profile`)).json(),
    );
    expect(view.badges).toBeUndefined();
  });
});
