import { createSnowflakeGenerator } from '@silvercord/protocol';
import { eq, sql } from 'drizzle-orm';
import { loadEnv } from '../config/env.ts';
import { userTotp } from '../modules/auth/auth-schema.ts';
import { hashPassword } from '../modules/auth/crypto/password-hasher.ts';
import { createSecretBox } from '../modules/auth/crypto/secret-box.ts';
import { generateTotpSecret } from '../modules/auth/totp.ts';
import { users } from '../modules/users/users-schema.ts';
import { createDatabase } from './client.ts';

/**
 * Development seed: opens registration and creates known accounts (BRIEF §11.3 `db:seed`).
 * The dedicated MFA account lets the screenshot tour reach the real verification screen.
 * Idempotent; refuses to run in production.
 */
export const SEED_PASSWORD = 'silvercord-dev-password';
export const SEED_ACCOUNTS = [
  { username: 'aurora', email: 'aurora@silvercord.localhost', displayName: 'Aurora', admin: true },
  { username: 'tide', email: 'tide@silvercord.localhost', displayName: 'Tide', admin: false },
  {
    username: 'mfa_preview',
    email: 'mfa@silvercord.localhost',
    displayName: 'MFA preview',
    admin: false,
  },
] as const;

const env = loadEnv();
if (env.NODE_ENV === 'production') {
  process.stderr.write('db:seed refuses to run with NODE_ENV=production\n');
  process.exit(1);
}

const handle = createDatabase(env.DATABASE_URL, { max: 1 });
const nextId = createSnowflakeGenerator({ workerId: 1023 });
try {
  const passwordHash = await hashPassword(SEED_PASSWORD);
  await handle.db.execute(sql`update instance_settings set registration_mode = 'open'`);
  for (const account of SEED_ACCOUNTS) {
    await handle.db
      .insert(users)
      .values({
        id: nextId(),
        username: account.username,
        email: account.email,
        displayName: account.displayName,
        passwordHash,
        locale: 'en',
        isInstanceAdmin: account.admin,
        ageConfirmedAt: sql`now()`,
        emailVerifiedAt: sql`now()`,
      })
      .onConflictDoNothing();
    if (account.username === 'mfa_preview') {
      const [user] = await handle.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.username, account.username))
        .limit(1);
      if (!user) throw new Error('MFA preview account missing');
      const { secretBase32 } = generateTotpSecret(account.username);
      await handle.db
        .insert(userTotp)
        .values({
          userId: user.id,
          secretEncrypted: createSecretBox(env.TOTP_ENCRYPTION_KEY).seal(Buffer.from(secretBase32)),
          confirmedAt: sql`now()`,
        })
        .onConflictDoNothing();
    }
  }
  process.stdout.write(
    `seeded ${SEED_ACCOUNTS.map((a) => a.username).join(', ')} (password: ${SEED_PASSWORD})\n`,
  );
} finally {
  await handle.close();
}
