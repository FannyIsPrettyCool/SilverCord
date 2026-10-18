import type { AuthTokens } from '@silvercord/protocol';
import { net } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuthAgent } from './auth-agent.ts';
import type { TokenStore } from './token-store.ts';

vi.mock('electron', () => ({ net: { fetch: vi.fn() } }));

const tokens: AuthTokens = {
  accessToken: 'access',
  accessTokenExpiresAt: '2030-10-18T12:00:00.000Z',
  refreshToken: 'refresh',
  user: {
    id: '1',
    username: 'user',
    displayName: null,
    email: 'user@example.test',
    emailVerified: false,
    isInstanceAdmin: false,
    mfaEnabled: false,
    locale: 'en',
    createdAt: '2026-10-18T00:00:00.000Z',
  },
};

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const response = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });
function setup() {
  let saved: string | null = null;
  const store: TokenStore = {
    persistent: true,
    load: vi.fn(async () => saved),
    save: vi.fn(async (value) => {
      saved = value;
    }),
    clear: vi.fn(async () => {
      saved = null;
    }),
  };
  return { agent: createAuthAgent('https://server.test', store), store, saved: () => saved };
}

describe('auth-agent cancellation', () => {
  beforeEach(() => vi.resetAllMocks());

  it.each(['login', 'register', 'second-factor'] as const)(
    'discards a %s response delivered after logout',
    async (kind) => {
      const { agent, store } = setup();
      if (kind === 'second-factor') {
        vi.mocked(net.fetch).mockResolvedValueOnce(
          response({ mfaRequired: true, ticket: 'ticket' }),
        );
        await agent.login('user', 'password');
      }
      const request = deferred<Response>();
      vi.mocked(net.fetch).mockReturnValueOnce(request.promise);
      const pending =
        kind === 'login'
          ? agent.login('user', 'password')
          : kind === 'register'
            ? agent.register({
                email: 'user@example.test',
                username: 'user',
                password: 'password123',
                ageConfirmed: true,
                locale: 'en',
              })
            : agent.loginSecondFactor({ code: '123456' });
      await agent.logout();
      const rejected = expect(pending).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
      request.resolve(response(tokens));
      await rejected;
      expect(store.save).not.toHaveBeenCalled();
      await expect(agent.accessToken()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    },
  );

  it('discards an MFA challenge delivered after logout', async () => {
    const { agent } = setup();
    const request = deferred<Response>();
    vi.mocked(net.fetch).mockReturnValueOnce(request.promise);
    const pending = agent.login('user', 'password');
    await agent.logout();
    const rejected = expect(pending).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    request.resolve(response({ mfaRequired: true, ticket: 'ticket' }));
    await rejected;
    await expect(agent.loginSecondFactor({ code: '123456' })).rejects.toMatchObject({
      code: 'TOKEN_INVALID',
    });
    expect(net.fetch).toHaveBeenCalledTimes(1);
  });

  it('finishes clearing storage after an in-flight save and rejects the stale sign-in', async () => {
    const { agent, store, saved } = setup();
    const writing = deferred<void>();
    const started = deferred<void>();
    const originalSave = store.save;
    vi.mocked(store.save).mockImplementationOnce(async (value) => {
      started.resolve();
      await writing.promise;
      await originalSave(value);
    });
    vi.mocked(net.fetch).mockResolvedValueOnce(response(tokens));
    const login = agent.login('user', 'password');
    await started.promise;
    vi.mocked(net.fetch).mockResolvedValueOnce(new Response(null, { status: 204 }));
    const logout = agent.logout();
    const rejected = expect(login).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    // Let logout enter its asynchronous storage clear before completing the older save.
    await vi.waitFor(async () => {
      await expect(agent.accessToken()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    });
    writing.resolve();
    await logout;
    await rejected;
    expect(saved()).toBeNull();
  });

  it('does not restore a token read from disk after logout', async () => {
    const { agent, store } = setup();
    const reading = deferred<string | null>();
    vi.mocked(store.load).mockReturnValueOnce(reading.promise);
    vi.mocked(net.fetch).mockResolvedValueOnce(response(tokens));
    const restoring = agent.restore();
    await agent.logout();
    reading.resolve('old-refresh');
    expect(await restoring).toBeNull();
    expect(net.fetch).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'keeps a new login while revoking an old session after a delayed refresh (already pending: %s)',
    async (alreadyPending) => {
      const { agent, store, saved } = setup();
      vi.mocked(net.fetch).mockResolvedValueOnce(
        response({
          ...tokens,
          accessTokenExpiresAt: '2020-01-01T00:00:00.000Z',
        }),
      );
      await agent.login('user', 'password');
      const refreshing = deferred<Response>();
      const newTokens: AuthTokens = {
        ...tokens,
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
        user: { ...tokens.user, id: '2', username: 'new-user' },
      };
      vi.mocked(net.fetch).mockImplementation(async (url) => {
        if (String(url).endsWith('/auth/refresh')) return refreshing.promise;
        if (String(url).endsWith('/auth/login')) return response(newTokens);
        return new Response(null, { status: 204 });
      });
      const oldRequest = alreadyPending ? agent.accessToken() : undefined;
      const oldRejected = oldRequest
        ? expect(oldRequest).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
        : undefined;
      const signingOut = agent.logout();
      await vi.waitFor(() =>
        expect(net.fetch).toHaveBeenCalledWith(
          'https://server.test/api/v1/auth/refresh',
          expect.anything(),
        ),
      );
      await agent.login('new-user', 'password');
      refreshing.resolve(
        response({
          ...tokens,
          accessToken: 'old-fresh-access',
          refreshToken: 'old-rotated-refresh',
        }),
      );
      await signingOut;
      await oldRejected;
      expect(await agent.accessToken()).toMatchObject({
        accessToken: 'new-access',
        user: { id: '2' },
      });
      expect(saved()).toBe('new-refresh');
      expect(store.save).toHaveBeenCalledTimes(2);
      expect(net.fetch).toHaveBeenCalledWith('https://server.test/api/v1/auth/logout', {
        method: 'POST',
        headers: { authorization: 'Bearer old-fresh-access' },
      });
      expect(
        vi.mocked(net.fetch).mock.calls.filter(([url]) => String(url).endsWith('/auth/refresh')),
      ).toHaveLength(1);
    },
  );
});
