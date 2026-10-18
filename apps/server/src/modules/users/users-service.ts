import type { CurrentUser, Locale, PublicUser } from '@silvercord/protocol';
import { eq, inArray, or, sql } from 'drizzle-orm';
import type { Executor } from '../../db/executor.ts';
import { type UserRow, users } from './users-schema.ts';

export interface NewUser {
  readonly id: bigint;
  readonly username: string;
  readonly email: string;
  readonly displayName: string | null;
  readonly passwordHash: string;
  readonly locale: Locale;
  readonly isInstanceAdmin: boolean;
}

/** The users module's public surface; other modules never touch the `users` table directly. */
export interface UsersService {
  create(ex: Executor, user: NewUser): Promise<UserRow>;
  findById(ex: Executor, id: bigint): Promise<UserRow | undefined>;
  findByLogin(ex: Executor, login: string): Promise<UserRow | undefined>;
  findByEmail(ex: Executor, email: string): Promise<UserRow | undefined>;
  /** Peer-safe projection; never expose email or account flags to other users. */
  findPublicByUsername(ex: Executor, username: string): Promise<PublicUser | undefined>;
  findPublicByIds(ex: Executor, ids: readonly bigint[]): Promise<PublicUser[]>;
  hasAnyUser(ex: Executor): Promise<boolean>;
  markEmailVerified(ex: Executor, id: bigint): Promise<void>;
  setPasswordHash(ex: Executor, id: bigint, passwordHash: string): Promise<void>;
  setDisplayName(ex: Executor, id: bigint, displayName: string | null): Promise<void>;
  toCurrentUser(row: UserRow, mfaEnabled: boolean): CurrentUser;
}

export function createUsersService(): UsersService {
  const projection = { id: users.id, username: users.username, displayName: users.displayName };
  const toPublic = (row: { id: bigint; username: string; displayName: string | null }) => ({
    ...row,
    id: row.id.toString(),
  });
  return {
    async findPublicByUsername(ex, username) {
      const [row] = await ex
        .select(projection)
        .from(users)
        .where(eq(users.username, username))
        .limit(1);
      return row ? toPublic(row) : undefined;
    },
    async findPublicByIds(ex, ids) {
      if (ids.length === 0) return [];
      const rows = await ex
        .select(projection)
        .from(users)
        .where(inArray(users.id, [...new Set(ids)]));
      return rows.map(toPublic);
    },
    async create(ex, user) {
      const [row] = await ex
        .insert(users)
        .values({ ...user, ageConfirmedAt: sql`now()` })
        .returning();
      if (!row) throw new Error('insert returned no row');
      return row;
    },
    async findById(ex, id) {
      const [row] = await ex.select().from(users).where(eq(users.id, id)).limit(1);
      return row;
    },
    async findByLogin(ex, login) {
      const [row] = await ex
        .select()
        .from(users)
        .where(or(eq(users.email, login), eq(users.username, login)))
        .limit(1);
      return row;
    },
    async findByEmail(ex, email) {
      const [row] = await ex.select().from(users).where(eq(users.email, email)).limit(1);
      return row;
    },
    async hasAnyUser(ex) {
      const [row] = await ex.select({ id: users.id }).from(users).limit(1);
      return row !== undefined;
    },
    async markEmailVerified(ex, id) {
      await ex
        .update(users)
        .set({
          emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, now())`,
          updatedAt: sql`now()`,
        })
        .where(eq(users.id, id));
    },
    async setDisplayName(ex, id, displayName) {
      await ex.update(users).set({ displayName, updatedAt: sql`now()` }).where(eq(users.id, id));
    },
    async setPasswordHash(ex, id, passwordHash) {
      await ex.update(users).set({ passwordHash, updatedAt: sql`now()` }).where(eq(users.id, id));
    },
    toCurrentUser(row, mfaEnabled) {
      return {
        id: row.id.toString(),
        username: row.username,
        displayName: row.displayName,
        email: row.email,
        emailVerified: row.emailVerifiedAt !== null,
        isInstanceAdmin: row.isInstanceAdmin,
        mfaEnabled,
        locale: row.locale,
        createdAt: row.createdAt.toISOString(),
      };
    },
  };
}
