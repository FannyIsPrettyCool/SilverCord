import type { CurrentUser } from '@silvercord/protocol';
import { create } from 'zustand';
import type { RegisterInput, SessionSnapshot } from '../../../shared/ipc-contract.ts';
import { desktop, unwrap } from '../desktop.ts';

type Status = 'restoring' | 'signed-out' | 'signed-in';

interface SessionState {
  readonly status: Status;
  readonly user: CurrentUser | null;
  /** False when the OS has no secure storage; the UI says the sign-in won't be remembered. */
  readonly persistent: boolean;
  restore(): Promise<void>;
  signIn(login: string, password: string): Promise<'signed-in' | 'mfa-required'>;
  secondFactor(factor: { code: string } | { recoveryCode: string }): Promise<void>;
  register(input: RegisterInput): Promise<void>;
  signOut(): Promise<void>;
  updateUser(user: CurrentUser): void;
}

/** Session as seen by the renderer: the main process owns the tokens (docs/spec/auth.md). */
export const useSession = create<SessionState>()((set) => {
  const adopt = (snapshot: SessionSnapshot) =>
    set({ status: 'signed-in', user: snapshot.user, persistent: snapshot.persistent });

  return {
    status: 'restoring',
    user: null,
    persistent: true,
    async restore() {
      try {
        const snapshot = await unwrap(desktop().auth.restore());
        if (snapshot) adopt(snapshot);
        else set({ status: 'signed-out', user: null });
      } catch {
        set({ status: 'signed-out', user: null });
      }
    },
    async signIn(login, password) {
      const outcome = await unwrap(desktop().auth.login({ login, password }));
      if (outcome.status === 'mfa-required') return 'mfa-required';
      adopt(outcome.session);
      return 'signed-in';
    },
    async secondFactor(factor) {
      adopt(await unwrap(desktop().auth.loginSecondFactor(factor)));
    },
    async register(input) {
      adopt(await unwrap(desktop().auth.register(input)));
    },
    async signOut() {
      await unwrap(desktop().auth.logout()).catch(() => null);
      set({ status: 'signed-out', user: null });
    },
    updateUser(user) {
      set({ user });
    },
  };
});
