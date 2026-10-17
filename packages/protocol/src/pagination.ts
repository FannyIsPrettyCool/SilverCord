import { z } from 'zod';
import { snowflakeSchema } from './snowflake.ts';

export const PAGE_LIMIT_DEFAULT = 50;
export const PAGE_LIMIT_MAX = 100;

/** Cursor pagination query (`before`/`after` are exclusive snowflake bounds). */
export const cursorPageQuerySchema = z
  .object({
    before: snowflakeSchema.optional(),
    after: snowflakeSchema.optional(),
    limit: z.coerce.number().int().min(1).max(PAGE_LIMIT_MAX).default(PAGE_LIMIT_DEFAULT),
  })
  .refine((query) => !(query.before && query.after), {
    message: 'use either before or after, not both',
    path: ['before'],
  });

export type CursorPageQuery = z.infer<typeof cursorPageQuerySchema>;
