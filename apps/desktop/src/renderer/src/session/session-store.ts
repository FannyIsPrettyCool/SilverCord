import type { CurrentUser } from '@silvercord/protocol';
import { create } from 'zustand';
import type { RegisterInput, SessionSnapshot } from '../../../shared/ipc-contract.ts';
import { DesktopError, desktop, unwrap } from '../desktop.ts';

type Status = 'restoring' | 'signed-out' | 'signed-in';

interface SessionState {
  readonly status: Status;
  readonly user: CurrentUser | null;
  /** False when the OS has no secure storage; the UI says the sign-in won't be remembered. */
  readonly persistent: boolean;
  /** A password step completed; the main process holds the actual MFA ticket. */
  readonly mfaPending: boolean;
  cancelMfa(): void;
  restore(): Promise<void>;
  signIn(login: string, password: string): Promise<'signed-in' | 'mfa-required'>;
  secondFactor(factor: { code: string } | { recoveryCode: string }): Promise<void>;
  register(input: RegisterInput): Promise<void>;
  signOut(): Promise<void>;
  updateUser(user: CurrentUser): void;
}

/** Session as seen by the renderer: the main process owns the tokens (docs/spec/auth.md). */
export const useSession = create<SessionState>()((set, get) => {
  const adopt = (snapshot: SessionSnapshot) =>
    set({
      status: 'signed-in',
      user: snapshot.user,
      persistent: snapshot.persistent,
      mfaPending: false,
    });

  return {
    status: 'restoring',
    user: null,
    persistent: true,
    mfaPending: false,
    cancelMfa() {
      set({ mfaPending: false });
    },
    async restore() {
      set({ mfaPending: false });
      try {
        const snapshot = await unwrap(desktop().auth.restore());
        if (snapshot) adopt(snapshot);
        else set({ status: 'signed-out', user: null });
      } catch {
        set({ status: 'signed-out', user: null });
      }
    },
    async signIn(login, password) {
      set({ mfaPending: false });
      const outcome = await unwrap(desktop().auth.login({ login, password }));
      if (outcome.status === 'mfa-required') {
        set({ mfaPending: true });
        return 'mfa-required';
      }
      adopt(outcome.session);
      return 'signed-in';
    },
    async secondFactor(factor) {
      if (!get().mfaPending) throw new DesktopError('TOKEN_INVALID', 'Sign in again');
      try {
        adopt(await unwrap(desktop().auth.loginSecondFactor(factor)));
      } catch (error) {
        if (
          error instanceof DesktopError &&
          ['TOKEN_INVALID', 'TOKEN_EXPIRED', 'TOKEN_REUSED', 'UNAUTHENTICATED'].includes(error.code)
        ) {
          set({ mfaPending: false });
        }
        throw error;
      }
    },
    async register(input) {
      set({ mfaPending: false });
      adopt(await unwrap(desktop().auth.register(input)));
    },
    async signOut() {
      set({ mfaPending: false });
      await unwrap(desktop().auth.logout()).catch(() => null);
      set({ status: 'signed-out', user: null });
    },
    updateUser(user) {
      set({ user });
    },
  };
});
