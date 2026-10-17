import { instanceInviteSchema } from '@silvercord/protocol';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, expectError, newAccount, register } from '../../../test/auth-helpers.ts';
import { createTestApp, type TestApp } from '../../../test/test-app.ts';

describe('POST /api/v1/auth/register', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  const post = (payload: Record<string, unknown>) =>
    t.request({ method: 'POST', url: '/api/v1/auth/register', payload });

  it('makes the first account instance admin even though the instance is invite-only', async () => {
    const { tokens } = await register(t);
    expect(tokens.user).toMatchObject({
      isInstanceAdmin: true,
      emailVerified: false,
      mfaEnabled: false,
    });
    expect(tokens.refreshToken.startsWith('scr_')).toBe(true);
  });

  it('requires an invite afterwards, and consumes it exactly once', async () => {
    expectError(await post(newAccount()), 403, 'INVITE_REQUIRED');
    expectError(await post(newAccount({ inviteCode: 'nope' })), 403, 'INVITE_REQUIRED');
  });

  it('accepts a valid invite created by the admin', async () => {
    const login = await t.request({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        login: (await firstAdmin()).email,
        password: 'correct horse battery staple',
        deviceName: 'Test Desktop',
      },
    });
    const adminTokens = login.json<{ accessToken: string }>();
    const created = await t.request({
      method: 'POST',
      url: '/api/v1/admin/invites',
      headers: bearer(adminTokens),
      payload: { maxUses: 1 },
    });
    expect(created.statusCode).toBe(201);
    const invite = instanceInviteSchema.parse(created.json());

    const ok = await post(newAccount({ inviteCode: invite.code }));
    expect(ok.statusCode).toBe(201);
    expect(ok.json<{ user: { isInstanceAdmin: boolean } }>().user.isInstanceAdmin).toBe(false);
    expectError(await post(newAccount({ inviteCode: invite.code })), 403, 'INVITE_REQUIRED');
  });

  it('refuses everyone when registration is closed', async () => {
    await t.context.database.db.execute(
      sql`update instance_settings set registration_mode = 'closed'`,
    );
    expectError(await post(newAccount()), 403, 'REGISTRATION_CLOSED');
    await t.context.database.db.execute(
      sql`update instance_settings set registration_mode = 'open'`,
    );
  });

  it('reports email and username conflicts case-insensitively', async () => {
    const { account } = await register(t);
    const taken = await post(newAccount({ email: account.email.toUpperCase() }));
    expectError(taken, 409, 'CONFLICT');
    expect(taken.json<{ error: { issues: { path: string }[] } }>().error.issues[0]?.path).toBe(
      'email',
    );
    expectError(
      await post(newAccount({ username: account.username.toUpperCase() })),
      409,
      'CONFLICT',
    );
  });

  it('validates input', async () => {
    expectError(await post(newAccount({ ageConfirmed: false })), 400, 'VALIDATION_FAILED');
    expectError(await post(newAccount({ password: 'short' })), 400, 'VALIDATION_FAILED');
    expectError(await post(newAccount({ username: 'admin' })), 400, 'VALIDATION_FAILED');
    expectError(await post(newAccount({ locale: 'de' })), 400, 'VALIDATION_FAILED');
  });

  it('sends a verification email that verifies once', async () => {
    const account = newAccount();
    const mail = t.mailer.next(account.email);
    expect((await post(account)).statusCode).toBe(201);
    const message = await mail;
    expect(message.text).toContain('silvercord://verify-email?token=sce_');
  });

  it('serializes concurrent first registrations into a single admin', async () => {
    const fresh = await createTestApp();
    try {
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          fresh.request({ method: 'POST', url: '/api/v1/auth/register', payload: newAccount() }),
        ),
      );
      const admins = results.filter(
        (r) =>
          r.statusCode === 201 &&
          r.json<{ user: { isInstanceAdmin: boolean } }>().user.isInstanceAdmin,
      );
      expect(admins).toHaveLength(1);
      expect(results.filter((r) => r.statusCode === 403)).toHaveLength(4);
    } finally {
      await fresh.close();
    }
  });

  async function firstAdmin() {
    const rows = await t.context.database.db.execute<{ email: string }>(
      sql`select email from users where is_instance_admin order by id limit 1`,
    );
    const row = rows[0];
    if (!row) throw new Error('no admin');
    return row;
  }
});
