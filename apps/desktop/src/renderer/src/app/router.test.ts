import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSession } from '../session/session-store.ts';
import { router } from './router.tsx';

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return { ...actual, createHashHistory: actual.createMemoryHistory };
});
vi.mock('../features/auth/CodeScreen.tsx', () => ({ CodeScreen: () => null }));
vi.mock('../features/auth/ForgotPasswordScreen.tsx', () => ({ ForgotPasswordScreen: () => null }));
vi.mock('../features/auth/RegisterScreen.tsx', () => ({ RegisterScreen: () => null }));
vi.mock('../features/auth/SignInScreen.tsx', () => ({ SignInScreen: () => null }));
vi.mock('../features/shell/AppShell.tsx', () => ({ AppShell: () => null }));

describe('MFA route guard', () => {
  const codeGuard = router.routesByPath['/sign-in/code'].options.beforeLoad as () => void;
  const signInGuard = router.routesByPath['/sign-in'].options.beforeLoad as () => void;
  const redirectedToSignIn = expect.objectContaining({
    options: expect.objectContaining({ to: '/sign-in' }),
  });

  beforeEach(() => {
    useSession.setState({ ...useSession.getInitialState(), status: 'signed-out' });
    vi.stubGlobal('window', {
      desktop: {
        auth: { login: vi.fn(async () => ({ ok: true, value: { status: 'mfa-required' } })) },
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('redirects a direct code URL to the password step', () => {
    expect(codeGuard).toThrow(redirectedToSignIn);
  });

  it('opens the code route after MFA login and clears it when returning to sign-in', async () => {
    await useSession.getState().signIn('user', 'password');
    expect(codeGuard).not.toThrow();
    signInGuard();
    expect(codeGuard).toThrow(redirectedToSignIn);
  });
});
