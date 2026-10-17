import { Redis } from 'ioredis';

export type Valkey = Redis;

/** Valkey connection (ioredis-compatible). `lazyConnect` keeps tests and boot ordering explicit. */
export function createValkey(url: string): Valkey {
  return new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 3, enableAutoPipelining: true });
}
