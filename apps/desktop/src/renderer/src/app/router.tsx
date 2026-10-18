import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import { CodeScreen } from '../features/auth/CodeScreen.tsx';
import { ForgotPasswordScreen } from '../features/auth/ForgotPasswordScreen.tsx';
import { RegisterScreen } from '../features/auth/RegisterScreen.tsx';
import { SignInScreen } from '../features/auth/SignInScreen.tsx';
import { ChannelView } from '../features/chat/ChannelView.tsx';
import { AppShell } from '../features/shell/AppShell.tsx';
import { FriendsView } from '../features/social/FriendsView.tsx';
import { useSession } from '../session/session-store.ts';

const signedIn = () => useSession.getState().status === 'signed-in';

const rootRoute = createRootRoute({ component: Outlet });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: signedIn() ? '/app' : '/sign-in' });
  },
});

/** Auth screens bounce signed-in users to the app; the app bounces signed-out users here. */
const guestOnly = () => {
  if (signedIn()) throw redirect({ to: '/app' });
};

const passwordStep = () => {
  guestOnly();
  useSession.getState().cancelMfa();
};

const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sign-in',
  beforeLoad: passwordStep,
  component: SignInScreen,
});
const codeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sign-in/code',
  beforeLoad: () => {
    guestOnly();
    if (!useSession.getState().mfaPending) throw redirect({ to: '/sign-in' });
  },
  component: CodeScreen,
});
const registerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/register',
  beforeLoad: passwordStep,
  component: RegisterScreen,
});
const forgotRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/forgot-password',
  beforeLoad: passwordStep,
  component: ForgotPasswordScreen,
});
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app',
  beforeLoad: () => {
    if (!signedIn()) throw redirect({ to: '/sign-in' });
  },
  component: AppShell,
});

const friendsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  component: FriendsView,
});
const channelRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/channels/$channelId',
  component: ChannelView,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  signInRoute,
  codeRoute,
  registerRoute,
  forgotRoute,
  appRoute.addChildren([friendsRoute, channelRoute]),
]);

/** Hash history: the packaged renderer is a single file on the app:// origin. */
export const router = createRouter({ routeTree, history: createHashHistory() });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
