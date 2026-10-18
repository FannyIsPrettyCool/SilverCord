import type { CurrentUser, ErrorCode } from '@silvercord/protocol';

/**
 * Renderer ↔ main contract. The renderer never sees refresh tokens or MFA tickets: the main
 * process holds them and talks to the auth API itself (threat model T5).
 * Type-only module, so the sandboxed preload bundle stays free of runtime dependencies.
 */
/** Server error codes plus the one failure only the client can see. */
export type DesktopErrorCode = ErrorCode | 'NETWORK';

export type IpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: DesktopErrorCode; message: string; field?: string } };

export interface SessionSnapshot {
  readonly user: CurrentUser;
  readonly accessToken: string;
  readonly accessTokenExpiresAt: string;
  /** False when the OS offers no secure storage: the session ends when the app quits. */
  readonly persistent: boolean;
}

export type LoginOutcome =
  | { status: 'signed-in'; session: SessionSnapshot }
  | { status: 'mfa-required' };

export interface RegisterInput {
  readonly email: string;
  readonly username: string;
  readonly password: string;
  readonly displayName?: string;
  readonly inviteCode?: string;
  readonly ageConfirmed: true;
  readonly locale: 'en' | 'fr';
}

export interface DesktopConfig {
  readonly apiUrl: string;
  readonly gatewayUrl: string;
  readonly platform: 'win32' | 'linux' | 'darwin' | 'other';
  readonly version: string;
}

/** Channel name → [input, output]. */
export interface IpcChannels {
  'config:get': [undefined, DesktopConfig];
  'auth:restore': [undefined, SessionSnapshot | null];
  'auth:register': [RegisterInput, SessionSnapshot];
  'auth:login': [{ login: string; password: string }, LoginOutcome];
  'auth:login-second-factor': [{ code: string } | { recoveryCode: string }, SessionSnapshot];
  'auth:access-token': [undefined, SessionSnapshot];
  'auth:logout': [undefined, null];
  'auth:forgot-password': [{ email: string }, null];
  'window:toggle-maximize': [undefined, boolean];
  /** Saves an attachment through a native dialog; false when the user cancels. */
  'media:download': [{ path: string; filename: string }, boolean];
}

export type IpcChannel = keyof IpcChannels;
export type IpcInput<C extends IpcChannel> = IpcChannels[C][0];
export type IpcOutput<C extends IpcChannel> = IpcChannels[C][1];

export const IPC_CHANNELS = [
  'config:get',
  'auth:restore',
  'auth:register',
  'auth:login',
  'auth:login-second-factor',
  'auth:access-token',
  'auth:logout',
  'auth:forgot-password',
  'window:toggle-maximize',
  'media:download',
] as const satisfies readonly IpcChannel[];
