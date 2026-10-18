import type { CurrentUser } from '@silvercord/protocol';
import type { DependencyList, EffectCallback } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { advanceAccountGeneration, captureAccountGeneration } from '../api/account-generation.ts';
import type { GatewayClientOptions } from './gateway-client.ts';

const harness = vi.hoisted(() => ({
  effects: [] as { effect: EffectCallback; dependencies: DependencyList }[],
  clients: [] as GatewayClientOptions[],
  config: vi.fn(),
  token: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  dispatch: vi.fn(),
  reconcile: vi.fn(),
  session: { status: 'signed-in', accountGeneration: 0, updateUser: vi.fn(), signOut: vi.fn() },
}));

// Exercise the actual effect and its callbacks without adding a DOM/test-renderer dependency.
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useEffect: (effect: EffectCallback, dependencies: DependencyList) => {
    harness.effects.push({ effect, dependencies });
  },
}));
vi.mock('../session/session-store.ts', () => ({
  useSession: Object.assign(
    (selector: (state: typeof harness.session) => unknown) => selector(harness.session),
    { getState: () => harness.session },
  ),
}));
vi.mock('../api/sync.ts', () => ({
  handleDispatch: harness.dispatch,
  reconcile: harness.reconcile,
}));
vi.mock('./gateway-client.ts', () => ({
  createGatewayClient: (options: GatewayClientOptions) => {
    harness.clients.push(options);
    return { start: harness.start, stop: harness.stop };
  },
}));

const { useGatewayConnection: runGatewayHook, useGatewayState } = await import(
  './use-gateway-connection.ts'
);
const cleanups: (() => void)[] = [];
const oldUser: CurrentUser = {
  id: '1',
  username: 'old-user',
  displayName: null,
  email: 'old@example.test',
  emailVerified: true,
  isInstanceAdmin: false,
  mfaEnabled: false,
  locale: 'en',
  createdAt: '2026-10-18T00:00:00.000Z',
};
const config = {
  ok: true,
  value: { gatewayUrl: 'wss://example.test/gateway/v1', version: '0.2.0', platform: 'linux' },
};

function runEffect() {
  runGatewayHook();
  const latest = harness.effects.at(-1);
  if (!latest) throw new Error('Gateway effect missing');
  const cleanup = latest.effect();
  if (cleanup) cleanups.push(cleanup);
  return latest;
}
async function connected() {
  runEffect();
  await vi.waitFor(() => expect(harness.clients).toHaveLength(1));
  const client = harness.clients[0];
  if (!client) throw new Error('Gateway client missing');
  return client;
}
function switchAccountBeforeEffectCleanup() {
  advanceAccountGeneration();
  harness.session.accountGeneration = captureAccountGeneration();
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.effects.length = 0;
  harness.clients.length = 0;
  harness.session.status = 'signed-in';
  harness.session.accountGeneration = captureAccountGeneration();
  harness.config.mockResolvedValue(config);
  harness.token.mockResolvedValue({ ok: true, value: { accessToken: 'old-token' } });
  useGatewayState.setState({ state: 'idle' });
  vi.stubGlobal('window', {
    desktop: { config: harness.config, auth: { accessToken: harness.token } },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
});
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.unstubAllGlobals();
});

describe('account-bound gateway effect', () => {
  it('delivers current account events and expires that current account on terminal auth failure', async () => {
    const client = await connected();
    client.onDispatch?.('USER_UPDATE', oldUser);
    client.onUnauthenticated?.();
    expect(harness.dispatch).toHaveBeenCalledWith('USER_UPDATE', oldUser);
    expect(harness.session.updateUser).toHaveBeenCalledWith(oldUser);
    expect(harness.session.signOut).toHaveBeenCalledOnce();
  });

  it('ignores old dispatch, auth failure and state callbacks before React cleans up the old socket', async () => {
    const client = await connected();
    switchAccountBeforeEffectCleanup();
    client.onDispatch?.('USER_UPDATE', oldUser);
    client.onDispatch?.('READY', { user: oldUser });
    client.onUnauthenticated?.();
    client.onState?.('ready');
    expect(harness.dispatch).not.toHaveBeenCalled();
    expect(harness.reconcile).not.toHaveBeenCalled();
    expect(harness.session.updateUser).not.toHaveBeenCalled();
    expect(harness.session.signOut).not.toHaveBeenCalled();
    expect(useGatewayState.getState().state).toBe('idle');
  });

  it('cannot start an old socket when configuration resolves after an account switch', async () => {
    const pending = Promise.withResolvers<typeof config>();
    harness.config.mockReturnValueOnce(pending.promise);
    runEffect();
    switchAccountBeforeEffectCleanup();
    pending.resolve(config);
    await pending.promise;
    await Promise.resolve();
    await Promise.resolve();
    expect(harness.clients).toHaveLength(0);
    expect(harness.start).not.toHaveBeenCalled();
  });

  it('discards late IPC tokens and never requests a new account token from an obsolete socket', async () => {
    const client = await connected();
    const pending = Promise.withResolvers<{ ok: true; value: { accessToken: string } }>();
    harness.token.mockReturnValueOnce(pending.promise);
    const token = client.getToken();
    const rejected = expect(token).rejects.toMatchObject({ name: 'AbortError' });
    switchAccountBeforeEffectCleanup();
    pending.resolve({ ok: true, value: { accessToken: 'old-token' } });
    await rejected;
    await expect(client.getToken()).rejects.toMatchObject({ name: 'AbortError' });
    expect(harness.token).toHaveBeenCalledOnce();
  });

  it('restarts the effect when the account changes while the signed-in status stays the same', async () => {
    const previous = runEffect();
    switchAccountBeforeEffectCleanup();
    const next = runEffect();
    expect(previous.dependencies).not.toEqual(next.dependencies);
  });
});
