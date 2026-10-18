import { Permission } from '@silvercord/permissions';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { createTokenIssuer } from '../modules/auth/crypto/access-tokens.ts';
import { registerAuthentication } from './authentication.ts';
import { registerErrorHandling } from './error-handler.ts';
import { registerOpenApi } from './openapi.ts';
import {
  InvalidPermissionDeclarationError,
  type PermissionChecker,
  type PermissionRequirement,
  registerPermissions,
} from './permissions.ts';

const tokens = createTokenIssuer('test-secret-with-at-least-thirty-two-characters');
function fixture(checker?: PermissionChecker) {
  const app = Fastify();
  registerErrorHandling(app);
  registerAuthentication(app, {
    tokens,
    revocations: { isRevoked: async () => false, revoke: async () => {} },
    isAuthSessionActive: async () => true,
    isInstanceAdmin: async () => true,
  });
  registerPermissions(app, checker);
  return app;
}
async function headers() {
  const { token } = await tokens.issueAccessToken({ userId: 10n, sessionId: 20n });
  return { authorization: `Bearer ${token}` };
}

describe('route permission declarations', () => {
  it.each(['GET', 'OPTIONS'] as const)('rejects an undeclared %s route', async (method) => {
    const app = fixture();
    try {
      expect(() =>
        app.route({ method, url: '/undeclared', config: { auth: 'public' }, handler: () => 'ok' }),
      ).toThrow(InvalidPermissionDeclarationError);
    } finally {
      await app.close();
    }
  });

  it.each([
    { scope: 'none', reason: '' },
    { scope: 'none', reason: '   ' },
    { scope: 'other', bits: 1n, param: 'id' },
    { scope: 'guild', bits: '1', param: 'id' },
    { scope: 'guild', bits: 0n, param: 'id' },
    { scope: 'guild', bits: -1n, param: 'id' },
    { scope: 'guild', bits: 1n << 63n, param: 'id' },
    { scope: 'guild', bits: 1n, param: 'otherId' },
    { scope: 'guild', bits: 1n, param: 'id?' },
    { scope: 'channel', bits: Permission.MANAGE_GUILD, param: 'id' },
  ])('rejects an invalid declaration: %s', async (permission) => {
    const app = fixture();
    try {
      expect(() =>
        app.get(
          '/resources/:id',
          { config: { auth: 'user', permission: permission as PermissionRequirement } },
          () => 'ok',
        ),
      ).toThrow(InvalidPermissionDeclarationError);
    } finally {
      await app.close();
    }
  });

  it.each(['public', 'instance-admin'] as const)(
    'rejects guild requirements with auth:%s',
    async (auth) => {
      const app = fixture();
      try {
        expect(() =>
          app.get(
            '/guilds/:id',
            { config: { auth, permission: { scope: 'guild', bits: 1n, param: 'id' } } },
            () => 'ok',
          ),
        ).toThrow(InvalidPermissionDeclarationError);
      } finally {
        await app.close();
      }
    },
  );

  it('exports JSON-safe metadata for the actual requirement, overriding handwritten metadata', async () => {
    const app = fixture();
    await registerOpenApi(app, 'test');
    app.get(
      '/guilds/:id',
      {
        config: {
          auth: 'user',
          permission: { scope: 'guild', bits: Permission.MANAGE_GUILD, param: 'id' },
        },
        schema: { 'x-permission': { scope: 'none', reason: 'Incorrect handwritten metadata' } },
      },
      () => 'ok',
    );
    try {
      await app.ready();
      const document = JSON.parse(JSON.stringify(app.swagger()));
      expect(document.paths['/guilds/{id}'].get['x-permission']).toEqual({
        scope: 'guild',
        bits: Permission.MANAGE_GUILD.toString(),
        param: 'id',
      });
    } finally {
      await app.close();
    }
  });
});

describe.each(['guild', 'channel'] as const)('%s permission execution', (scope) => {
  const bits = scope === 'guild' ? Permission.MANAGE_GUILD : Permission.SEND_MESSAGES;
  it.each([
    { visible: false, permissions: bits, expected: 404 },
    { visible: true, permissions: 0n, expected: 403 },
    { visible: true, permissions: bits, expected: 200 },
  ])('returns $expected for $visible/$permissions', async ({ visible, permissions, expected }) => {
    const checker = vi.fn(async () => ({ visible, permissions }));
    const app = fixture(checker);
    const handler = vi.fn(() => ({ ok: true }));
    app.post(
      '/resources/:resourceId',
      { config: { auth: 'user', permission: { scope, bits, param: 'resourceId' } } },
      handler,
    );
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/resources/30',
        headers: await headers(),
      });
      expect(response.statusCode).toBe(expected);
      expect(checker).toHaveBeenCalledExactlyOnceWith({ scope, resourceId: 30n, userId: 10n });
      expect(handler).toHaveBeenCalledTimes(expected === 200 ? 1 : 0);
    } finally {
      await app.close();
    }
  });

  it('re-reads permissions after revocation rather than using a cached grant', async () => {
    const checker = vi
      .fn()
      .mockResolvedValueOnce({ visible: true, permissions: bits })
      .mockResolvedValueOnce({ visible: true, permissions: 0n });
    const app = fixture(checker);
    app.get(
      '/resources/:id',
      { config: { auth: 'user', permission: { scope, bits, param: 'id' } } },
      () => 'ok',
    );
    try {
      const auth = await headers();
      expect((await app.inject({ url: '/resources/30', headers: auth })).statusCode).toBe(200);
      expect((await app.inject({ url: '/resources/30', headers: auth })).statusCode).toBe(403);
      expect(checker).toHaveBeenCalledTimes(2);
    } finally {
      await app.close();
    }
  });

  it('authenticates before consulting permissions and never invokes the handler on malformed ids', async () => {
    const checker = vi.fn(async () => ({ visible: true, permissions: bits }));
    const app = fixture(checker);
    const handler = vi.fn(() => 'ok');
    app.get(
      '/resources/:id',
      { config: { auth: 'user', permission: { scope, bits, param: 'id' } } },
      handler,
    );
    try {
      expect((await app.inject('/resources/30')).statusCode).toBe(401);
      expect(
        (await app.inject({ url: '/resources/invalid', headers: await headers() })).statusCode,
      ).toBe(400);
      expect((await app.inject('/unknown')).statusCode).toBe(404);
      expect(checker).not.toHaveBeenCalled();
      expect(handler).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it.each([
    undefined,
    async () => {
      throw new Error('Database unavailable');
    },
    async () => ({ visible: true, permissions: -1n }),
    async () => ({ visible: true, permissions: 1n << 63n }),
  ])('fails closed when the checker is unavailable or invalid (%s)', async (checker) => {
    const app = fixture(checker);
    const handler = vi.fn(() => 'ok');
    app.get(
      '/resources/:id',
      { config: { auth: 'user', permission: { scope, bits, param: 'id' } } },
      handler,
    );
    try {
      const response = await app.inject({ url: '/resources/30', headers: await headers() });
      expect(response.statusCode).toBe(500);
      expect(handler).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
