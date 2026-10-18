import {
  badgeIconNameSchema,
  badgeRaritySchema,
  createSnowflakeGenerator,
  usernameSchema,
} from '@silvercord/protocol';
import { asc, eq } from 'drizzle-orm';
import { pino } from 'pino';
import { loadEnv } from '../../config/env.ts';
import { closeAppContext, createAppContext } from '../../context.ts';
import { createChatServices } from '../../services.ts';
import { users } from '../users/users-schema.ts';

/**
 * Operator command (docs/RUNBOOK.md): manual badges from the host, attributed to the oldest
 * instance administrator.
 *   badge-cli.ts list
 *   badge-cli.ts create <name> <description> <rarity> <icon>
 *   badge-cli.ts award <badgeId> <username> [reason]
 */
const [command, ...args] = process.argv.slice(2);
const usage = () => {
  process.stderr.write(
    'Usage: badge-cli.ts list | create <name> <description> <rarity> <icon> | award <badgeId> <username> [reason]\n',
  );
  process.exit(2);
};
if (!command || !['list', 'create', 'award'].includes(command)) usage();

const env = loadEnv();
const log = pino({ level: 'info' });
// Distinct from the API's worker ids, the invite CLI (1022) and the development seed (1023).
const context = await createAppContext(env, {
  nextId: createSnowflakeGenerator({ workerId: 1021 }),
});
try {
  const services = createChatServices(context, { log, enqueueMedia: async () => {} });
  const [admin] = await services.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.isInstanceAdmin, true))
    .orderBy(asc(users.id))
    .limit(1);
  if (!admin) throw new Error('no instance administrator exists');
  if (command === 'list') {
    for (const badge of await services.badges.definitions(admin.id))
      process.stdout.write(`${badge.id}\t${badge.rarity}\t${badge.key ?? badge.name}\n`);
  } else if (command === 'create') {
    const [name, description, rarity, icon] = args;
    const parsedRarity = badgeRaritySchema.safeParse(rarity);
    const parsedIcon = badgeIconNameSchema.safeParse(icon);
    if (!name || description === undefined || !parsedRarity.success || !parsedIcon.success) usage();
    else {
      const badge = await services.badges.create(admin.id, {
        name,
        description,
        rarity: parsedRarity.data,
        iconName: parsedIcon.data,
      });
      process.stdout.write(`${badge.id}\t${badge.name}\n`);
    }
  } else {
    const [badgeId, username, reason] = args;
    const parsedName = usernameSchema.safeParse(username);
    if (!badgeId || !/^\d{1,19}$/.test(badgeId) || !parsedName.success) usage();
    else {
      const award = await services.badges.award(
        admin.id,
        BigInt(badgeId),
        parsedName.data,
        reason ?? null,
      );
      process.stdout.write(`awarded ${award.badge.name} to ${parsedName.data}\n`);
    }
  }
} finally {
  await closeAppContext(context);
}
