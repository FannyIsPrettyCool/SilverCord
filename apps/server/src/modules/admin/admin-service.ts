import { randomBytes } from 'node:crypto';
import type { InstanceInvite, RegistrationMode } from '@silvercord/protocol';
import { and, eq, gt, lt, sql } from 'drizzle-orm';
import type { Executor } from '../../db/executor.ts';
import { instanceInvites, instanceSettings } from './admin-schema.ts';

export interface AdminService {
  registrationMode(ex: Executor): Promise<RegistrationMode>;
  /** Atomically uses one slot of a valid invite; false when missing, expired or exhausted. */
  consumeInvite(ex: Executor, code: string): Promise<boolean>;
  createInvite(
    ex: Executor,
    input: { id: bigint; createdBy: bigint; maxUses: number; expiresInHours: number },
  ): Promise<InstanceInvite>;
}

export function createAdminService(): AdminService {
  return {
    async registrationMode(ex) {
      const [row] = await ex
        .select({ mode: instanceSettings.registrationMode })
        .from(instanceSettings)
        .where(eq(instanceSettings.id, 1));
      // Migration 0002 guarantees the row; a missing one means a broken install.
      if (!row) throw new Error('instance_settings row missing');
      return row.mode;
    },
    async consumeInvite(ex, code) {
      const updated = await ex
        .update(instanceInvites)
        .set({ uses: sql`${instanceInvites.uses} + 1` })
        .where(
          and(
            eq(instanceInvites.code, code),
            lt(instanceInvites.uses, instanceInvites.maxUses),
            gt(instanceInvites.expiresAt, sql`now()`),
          ),
        )
        .returning({ id: instanceInvites.id });
      return updated.length === 1;
    },
    async createInvite(ex, input) {
      const [row] = await ex
        .insert(instanceInvites)
        .values({
          id: input.id,
          code: randomBytes(9).toString('base64url'),
          createdBy: input.createdBy,
          maxUses: input.maxUses,
          expiresAt: sql`now() + make_interval(hours => ${input.expiresInHours})`,
        })
        .returning();
      if (!row) throw new Error('insert returned no row');
      return {
        id: row.id.toString(),
        code: row.code,
        maxUses: row.maxUses,
        uses: row.uses,
        expiresAt: row.expiresAt.toISOString(),
      };
    },
  };
}
