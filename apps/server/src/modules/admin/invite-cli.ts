import { createSnowflakeGenerator } from '@silvercord/protocol';
import { asc, eq } from 'drizzle-orm';
import { loadEnv } from '../../config/env.ts';
import { createDatabase } from '../../db/client.ts';
import { users } from '../users/users-schema.ts';
import { createAdminService } from './admin-service.ts';

/**
 * Operator command (docs/RUNBOOK.md): creates registration invites from the host, attributed to
 * the oldest instance administrator, without signing in. Usage: `[count] [maxUses] [hours]`.
 */
const [count = 1, maxUses = 1, expiresInHours = 24 * 7] = process.argv
  .slice(2)
  .map((value) => Number(value));
if (
  !Number.isInteger(count) ||
  count < 1 ||
  count > 50 ||
  !Number.isInteger(maxUses) ||
  maxUses < 1 ||
  maxUses > 1000 ||
  !Number.isInteger(expiresInHours) ||
  expiresInHours < 1 ||
  expiresInHours > 24 * 90
) {
  process.stderr.write('Usage: invite-cli.ts [count 1-50] [maxUses 1-1000] [hours 1-2160]\n');
  process.exit(2);
}

const env = loadEnv();
const handle = createDatabase(env.DATABASE_URL, { max: 1 });
// Distinct from the API's worker ids and the development seed (1023).
const nextId = createSnowflakeGenerator({ workerId: 1022 });
try {
  const [admin] = await handle.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.isInstanceAdmin, true))
    .orderBy(asc(users.id))
    .limit(1);
  if (!admin) throw new Error('no instance administrator exists');
  const service = createAdminService();
  for (let index = 0; index < count; index += 1) {
    const invite = await service.createInvite(handle.db, {
      id: nextId(),
      createdBy: admin.id,
      maxUses,
      expiresInHours,
    });
    process.stdout.write(`${invite.code}\t${invite.maxUses} use(s)\texpires ${invite.expiresAt}\n`);
  }
} finally {
  await handle.close();
}
