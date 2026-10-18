import { createSnowflakeGenerator } from '@silvercord/protocol';
import { eq, sql } from 'drizzle-orm';
import { loadEnv } from '../config/env.ts';
import { userTotp } from '../modules/auth/auth-schema.ts';
import { hashPassword } from '../modules/auth/crypto/password-hasher.ts';
import { createSecretBox } from '../modules/auth/crypto/secret-box.ts';
import { generateTotpSecret } from '../modules/auth/totp.ts';
import { channelMembers, channels, dmPairs } from '../modules/channels/channels-schema.ts';
import { messages } from '../modules/messages/messages-schema.ts';
import { relationshipPairs } from '../modules/relationships/relationships-schema.ts';
import { users } from '../modules/users/users-schema.ts';
import { createDatabase } from './client.ts';

/**
 * Development seed: opens registration and creates known accounts (BRIEF §11.3 `db:seed`).
 * The dedicated MFA account lets the screenshot tour reach the real verification screen.
 * aurora and tide are friends with a DM of SEED_MESSAGES (default 120) messages; aurora and
 * mfa_preview get a DM of SEED_PERF_MESSAGES (default 0, 10000 for the scroll check). Idempotent; refuses to run in production.
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

const LINES = [
  'Morning! **Coffee** first, then the release notes.',
  'The new composer handles `inline code` and ||spoilers|| now.',
  'Pushed the fix, can you check <t:1792300000:R>?',
  '> Ship it when the checks are green\nAgreed.',
  'https://silvercord.islandmon.cloud is live',
  'Lunch?',
  '- notes\n- screenshots\n- invite codes',
  'Testing *italic*, ~~strike~~ and __underline__.',
];

/** Friendship, DM and a history of `count` messages between two seed accounts. */
async function seedConversation(first: string, second: string, count: number) {
  const rows = await handle.db
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(sql`${users.username} in (${first}, ${second})`);
  const aurora = rows.find((row) => row.username === first)?.id;
  const tide = rows.find((row) => row.username === second)?.id;
  if (!aurora || !tide) throw new Error('seed accounts missing');
  const [low, high] = aurora < tide ? [aurora, tide] : [tide, aurora];
  await handle.db
    .insert(relationshipPairs)
    .values({ id: nextId(), userLow: low, userHigh: high, state: 'friends' })
    .onConflictDoNothing();
  const [existing] = await handle.db
    .select({ channelId: dmPairs.channelId })
    .from(dmPairs)
    .where(sql`${dmPairs.userLow} = ${low} and ${dmPairs.userHigh} = ${high}`);
  if (existing) return;
  const channelId = nextId();
  await handle.db.insert(channels).values({ id: channelId, type: 'dm' });
  await handle.db.insert(dmPairs).values({ userLow: low, userHigh: high, channelId });
  await handle.db.insert(channelMembers).values([
    { channelId, userId: low },
    { channelId, userId: high },
  ]);
  const start = Date.now() - count * 90_000;
  let last = 0n;
  for (let offset = 0; offset < count; offset += 1000) {
    const batch = Array.from({ length: Math.min(1000, count - offset) }, (_, index) => {
      const position = offset + index;
      last = nextId();
      return {
        id: last,
        channelId,
        authorId: position % 3 === 0 ? tide : aurora,
        content: LINES[position % LINES.length] ?? '',
        createdAt: new Date(start + position * 90_000),
      };
    });
    await handle.db.insert(messages).values(batch);
  }
  if (count > 0)
    await handle.db
      .update(channels)
      .set({ lastMessageId: last })
      .where(sql`${channels.id} = ${channelId}`);
}
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
  await seedConversation('aurora', 'tide', Number(process.env['SEED_MESSAGES'] ?? 120));
  // Scroll performance fixture (docs/PERF.md): a separate DM with a long history.
  await seedConversation('aurora', 'mfa_preview', Number(process.env['SEED_PERF_MESSAGES'] ?? 0));
  process.stdout.write(
    `seeded ${SEED_ACCOUNTS.map((a) => a.username).join(', ')} (password: ${SEED_PASSWORD})\n`,
  );
} finally {
  await handle.close();
}
