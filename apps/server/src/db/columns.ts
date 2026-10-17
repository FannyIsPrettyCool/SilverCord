import { bigint, customType, timestamp } from 'drizzle-orm/pg-core';

/** Snowflake primary/foreign key: Postgres bigint, JS bigint (BRIEF §5.1). */
export const snowflake = (name?: string) =>
  name === undefined ? bigint({ mode: 'bigint' }) : bigint(name, { mode: 'bigint' });

export const timestamptz = () => timestamp({ withTimezone: true, mode: 'date' });

export const citext = customType<{ data: string }>({ dataType: () => 'citext' });

export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});
