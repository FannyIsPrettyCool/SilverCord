import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionSnapshot } from '../../../shared/ipc-contract.ts';
import { DesktopError } from '../desktop.ts';
import { useSession } from './session-store.ts';

const snapshot: SessionSnapshot = {
  accessToken: 'access',
  accessTokenExpiresAt: '2026-10-18T12:00:00.000Z',
  persistent: true,
  user: {
    id: '1',
    username: 'user',
    displayName: null,
    email: 'user@example.test',
    emailVerified: false,
    isInstanceAdmin: false,
    mfaEnabled: true,
    locale: 'en',
    createdAt: '2026-10-18T00:00:00.000Z',
  },
};

const auth = {
  login: vi.fn(),
  loginSecondFactor: vi.fn(),
  register: vi.fn(),
  restore: vi.fn(),
  logout: vi.fn(),
};

describe('renderer MFA state', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useSession.setState(useSession.getInitialState());
    vi.stubGlobal('window', { desktop: { auth } });
    auth.login.mockResolvedValue({ ok: true, value: { status: 'mfa-required' } });
    auth.logout.mockResolvedValue({ ok: true, value: null });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('allows a code only after the password step and clears it after success', async () => {
    expect(useSession.getState().mfaPending).toBe(false);
    await expect(useSession.getState().secondFactor({ code: '123456' })).rejects.toMatchObject({
      code: 'TOKEN_INVALID',
    });
    expect(auth.loginSecondFactor).not.toHaveBeenCalled();
    await expect(useSession.getState().signIn('user', 'password')).resolves.toBe('mfa-required');
    expect(useSession.getState().mfaPending).toBe(true);
    auth.loginSecondFactor.mockResolvedValue({ ok: true, value: snapshot });
    await useSession.getState().secondFactor({ code: '123456' });
    expect(useSession.getState()).toMatchObject({ status: 'signed-in', mfaPending: false });
  });

  it.each(['NETWORK', 'RATE_LIMITED', 'INVALID_TOTP'])('allows retry after %s', async (code) => {
    await useSession.getState().signIn('user', 'password');
    auth.loginSecondFactor.mockRejectedValue(new DesktopError(code, 'Retry'));
    await expect(useSession.getState().secondFactor({ code: '123456' })).rejects.toMatchObject({
      code,
    });
    expect(useSession.getState().mfaPending).toBe(true);
  });

  it.each(['TOKEN_INVALID', 'TOKEN_EXPIRED', 'TOKEN_REUSED', 'UNAUTHENTICATED'])(
    'clears a pending challenge after %s',
    async (code) => {
      await useSession.getState().signIn('user', 'password');
      auth.loginSecondFactor.mockRejectedValue(new DesktopError(code, 'Expired'));
      await expect(useSession.getState().secondFactor({ code: '123456' })).rejects.toMatchObject({
        code,
      });
      expect(useSession.getState().mfaPending).toBe(false);
    },
  );

  it('clears an old challenge before a new password attempt, even if that attempt fails', async () => {
    await useSession.getState().signIn('user', 'password');
    auth.login.mockRejectedValue(new DesktopError('INVALID_CREDENTIALS', 'Wrong password'));
    await expect(useSession.getState().signIn('other', 'wrong')).rejects.toThrow();
    expect(useSession.getState().mfaPending).toBe(false);
  });

  it('clears a challenge on sign-out and session restore', async () => {
    await useSession.getState().signIn('user', 'password');
    await useSession.getState().signOut();
    expect(useSession.getState().mfaPending).toBe(false);
    await useSession.getState().signIn('user', 'password');
    auth.restore.mockResolvedValue({ ok: true, value: null });
    await useSession.getState().restore();
    expect(useSession.getState().mfaPending).toBe(false);
  });

  it('cannot adopt a late login after sign-out', async () => {
    const result = Promise.withResolvers<unknown>();
    auth.login.mockReturnValueOnce(result.promise);
    const request = useSession.getState().signIn('user', 'password');
    const rejected = expect(request).rejects.toMatchObject({ name: 'AbortError' });
    await useSession.getState().signOut();
    result.resolve({ ok: true, value: { status: 'authenticated', session: snapshot } });
    await rejected;
    expect(useSession.getState()).toMatchObject({ status: 'signed-out', user: null });
  });

  it('ignores a late restore failure after a successful new login', async () => {
    const result = Promise.withResolvers<unknown>();
    auth.restore.mockReturnValueOnce(result.promise);
    const old = useSession.getState().restore();
    await useSession.getState().signOut();
    auth.login.mockResolvedValueOnce({
      ok: true,
      value: { status: 'authenticated', session: snapshot },
    });
    await useSession.getState().signIn('user', 'password');
    result.reject(new Error('old restore failed'));
    await old;
    expect(useSession.getState()).toMatchObject({ status: 'signed-in', user: snapshot.user });
  });
});
