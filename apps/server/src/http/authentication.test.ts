import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { createTokenIssuer } from '../modules/auth/crypto/access-tokens.ts';
import { registerAuthentication } from './authentication.ts';
import { registerErrorHandling } from './error-handler.ts';

describe('authoritative session authentication', () => {
  it.each([false, true])(
    'checks the database when a revocation marker is missing (active=%s)',
    async (active) => {
      const tokens = createTokenIssuer('test-secret-with-at-least-thirty-two-characters');
      const app = Fastify();
      const isAuthSessionActive = vi.fn(async () => active);
      registerErrorHandling(app);
      registerAuthentication(app, {
        tokens,
        revocations: { isRevoked: async () => false, revoke: async () => {} },
        isInstanceAdmin: async () => false,
        isAuthSessionActive,
      });
      app.get('/private', { config: { auth: 'user' } }, async () => ({ ok: true }));
      try {
        const { token } = await tokens.issueAccessToken({ userId: 1n, sessionId: 2n });
        const response = await app.inject({
          url: '/private',
          headers: { authorization: `Bearer ${token}` },
        });
        expect(response.statusCode).toBe(active ? 200 : 401);
        expect(isAuthSessionActive).toHaveBeenCalledWith(2n);
        if (!active) expect(response.json()).toMatchObject({ error: { code: 'TOKEN_INVALID' } });
      } finally {
        await app.close();
      }
    },
  );
});
