import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const snapshot = (token: string) => ({
  ok: true,
  value: { accessToken: token, accessTokenExpiresAt: '2099-01-01T00:00:00.000Z' },
});

describe('account-bound REST work', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  async function setup() {
    const token = vi.fn(async () => snapshot('account-a'));
    vi.stubGlobal('window', {
      desktop: {
        config: async () => ({
          ok: true,
          value: { apiUrl: 'https://api.example.test', mediaUrl: 'https://media.example.test' },
        }),
        auth: { accessToken: token },
      },
    });
    return {
      client: await import('./api-client.ts'),
      account: await import('./account-generation.ts'),
      token,
    };
  }

  it('discards a late token instead of caching it for the next account', async () => {
    const { client, account, token } = await setup();
    const pending = Promise.withResolvers<ReturnType<typeof snapshot>>();
    token.mockReturnValueOnce(pending.promise);
    const old = client.accessToken();
    const rejected = expect(old).rejects.toMatchObject({ name: 'AbortError' });
    account.advanceAccountGeneration();
    client.forgetAccessToken();
    pending.resolve(snapshot('account-a'));
    await rejected;
    token.mockResolvedValueOnce(snapshot('account-b'));
    expect(await client.accessToken()).toBe('account-b');
  });

  it('does not retry an obsolete request using the next account token', async () => {
    const { client, account, token } = await setup();
    const pending = Promise.withResolvers<Response>();
    const fetcher = vi.fn(() => pending.promise);
    vi.stubGlobal('fetch', fetcher);
    const old = client.apiResponse('/api/v1/users/@me');
    const rejected = expect(old).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    account.advanceAccountGeneration();
    pending.resolve(
      Response.json({ error: { code: 'TOKEN_EXPIRED', message: 'Expired' } }, { status: 401 }),
    );
    await rejected;
    expect(token).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('discards JSON that finishes decoding after an account switch', async () => {
    const { client, account } = await setup();
    const pending = Promise.withResolvers<unknown>();
    const response = Response.json({ value: 'old-private-data' });
    response.json = vi.fn(() => pending.promise);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response),
    );
    const old = client.api(z.object({ value: z.string() }), '/api/v1/private');
    const rejected = expect(old).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(response.json).toHaveBeenCalledOnce());
    account.advanceAccountGeneration();
    pending.resolve({ value: 'old-private-data' });
    await rejected;
  });

  it('fetches authorized media only from the configured media origin', async () => {
    const { client } = await setup();
    const fetcher = vi.fn(async () => new Response('media'));
    vi.stubGlobal('fetch', fetcher);
    const path = `/media/123/display/${'a'.repeat(64)}`;
    await client.apiResponse(path);
    const [url, options] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.href).toBe(`https://media.example.test${path}`);
    expect(options.headers).toMatchObject({ authorization: 'Bearer account-a' });
    expect(options.redirect).toBe('error');
  });

  it.each([
    '//attacker.example/private',
    '/\\attacker.example/private',
    '/\n/attacker.example/private',
  ])('refuses an external-origin path %j', async (path) => {
    const { client } = await setup();
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(client.apiResponse(path)).rejects.toThrow('Invalid API path');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
