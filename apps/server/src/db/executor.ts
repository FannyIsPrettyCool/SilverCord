import type { Database } from './client.ts';

export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/** A database handle or an open transaction; repositories accept either. */
export type Executor = Database | Transaction;

/** Postgres unique-violation details from postgres.js errors. */
export function uniqueViolation(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const candidate = 'cause' in error && typeof error.cause === 'object' ? error.cause : error;
  if (candidate === null || typeof candidate !== 'object') return null;
  const code = 'code' in candidate ? candidate.code : undefined;
  const constraint = 'constraint_name' in candidate ? candidate.constraint_name : undefined;
  return code === '23505' && typeof constraint === 'string' ? constraint : null;
}
