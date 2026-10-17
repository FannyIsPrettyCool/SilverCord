import { z } from 'zod';
import { snowflakeSchema } from './snowflake.ts';

export const USERNAME_MIN = 2;
export const USERNAME_MAX = 32;

/** Handles that could impersonate the system or collide with mention syntax. */
export const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  'admin',
  'administrator',
  'system',
  'silvercord',
  'everyone',
  'here',
  'moderator',
  'mod',
  'support',
  'staff',
  'root',
  'null',
  'undefined',
  'me',
  'deleted.user',
]);

/** Lowercase handle: `[a-z0-9_.]`, no leading/trailing/double dots. Input is lowercased first. */
export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(USERNAME_MIN)
  .max(USERNAME_MAX)
  .regex(/^[a-z0-9_.]+$/, 'only letters, digits, underscores and dots')
  .refine((value) => !value.startsWith('.') && !value.endsWith('.') && !value.includes('..'), {
    message: 'dots cannot lead, trail or repeat',
  })
  .refine((value) => !RESERVED_USERNAMES.has(value), { message: 'username is reserved' });

export const displayNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(32)
  // Control and invisible formatting characters make names unreadable or spoofable.
  .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value), { message: 'invalid characters' });

export const localeSchema = z.enum(['en', 'fr']);
export type Locale = z.infer<typeof localeSchema>;

export const currentUserSchema = z.object({
  id: snowflakeSchema,
  username: z.string(),
  displayName: z.string().nullable(),
  email: z.email(),
  emailVerified: z.boolean(),
  isInstanceAdmin: z.boolean(),
  mfaEnabled: z.boolean(),
  locale: localeSchema,
  createdAt: z.iso.datetime(),
});

export type CurrentUser = z.infer<typeof currentUserSchema>;
