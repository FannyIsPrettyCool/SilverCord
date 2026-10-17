import type { Valkey } from '../../infra/valkey.ts';
import { ACCESS_TOKEN_TTL_SECONDS } from './crypto/access-tokens.ts';

/**
 * Fast revocation check for access tokens. A revoked session id is remembered for as long as an
 * access token issued before the revocation can live; after that, refresh fails on the DB row.
 */
export interface SessionRevocations {
  revoke(sessionId: bigint): Promise<void>;
  isRevoked(sessionId: bigint): Promise<boolean>;
}

export function createSessionRevocations(valkey: Valkey): SessionRevocations {
  const key = (sessionId: bigint) => `revoked-session:${sessionId}`;
  // Clock tolerance on JWT verification extends a token's life slightly beyond its TTL.
  const ttl = ACCESS_TOKEN_TTL_SECONDS + 60;
  return {
    async revoke(sessionId) {
      await valkey.set(key(sessionId), '1', 'EX', ttl);
    },
    async isRevoked(sessionId) {
      return (await valkey.exists(key(sessionId))) === 1;
    },
  };
}
