import type { CurrentUser, ErrorCode } from '@silvercord/protocol';

/**
 * Renderer ↔ main contract. The renderer never sees refresh tokens or MFA tickets: the main
 * process holds them and talks to the auth API itself (threat model T5).
 * Type-only module, so the sandboxed preload bundle stays free of runtime dependencies.
 */
export type IpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: ErrorCode | 'NETWORK'; message: string } };

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
  'config:get': [void, DesktopConfig];
  'auth:restore': [void, SessionSnapshot | null];
  'auth:register': [RegisterInput, SessionSnapshot];
  'auth:login': [{ login: string; password: string }, LoginOutcome];
  'auth:login-second-factor': [{ code: string } | { recoveryCode: string }, SessionSnapshot];
  'auth:access-token': [void, SessionSnapshot];
  'auth:logout': [void, null];
  'window:minimize': [void, null];
  'window:toggle-maximize': [void, boolean];
  'window:close': [void, null];
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
  'window:minimize',
  'window:toggle-maximize',
  'window:close',
] as const satisfies readonly IpcChannel[];
