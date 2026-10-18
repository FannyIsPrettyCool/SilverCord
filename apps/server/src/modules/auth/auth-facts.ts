import type { Executor } from '../../db/executor.ts';
import { authRepository as repo } from './auth-repository.ts';

/** Read-only account security facts other modules may ask about (e.g. badge rules). */
export const authFacts = {
  async mfaEnabled(ex: Executor, userId: bigint): Promise<boolean> {
    return (await repo.findTotp(ex, userId))?.confirmedAt != null;
  },
};
export type AuthFacts = typeof authFacts;
