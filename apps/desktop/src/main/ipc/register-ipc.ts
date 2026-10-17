import {
  displayNameSchema,
  emailSchema,
  localeSchema,
  passwordSchema,
  recoveryCodeSchema,
  totpCodeSchema,
  usernameSchema,
} from '@silvercord/protocol';
import { type BrowserWindow, type IpcMainInvokeEvent, ipcMain } from 'electron';
import { z } from 'zod';
import {
  type DesktopConfig,
  IPC_CHANNELS,
  type IpcChannel,
  type IpcInput,
  type IpcOutput,
  type IpcResult,
} from '../../shared/ipc-contract.ts';
import { ApiError, type AuthAgent } from '../auth/auth-agent.ts';
import { isTrustedSender } from './trusted-sender.ts';

const none = z.undefined();

/** Runtime validation for every channel input (BRIEF §8.2). */
const inputSchemas: { [C in IpcChannel]: z.ZodType<IpcInput<C>> } = {
  'config:get': none,
  'auth:restore': none,
  'auth:register': z.object({
    email: emailSchema,
    username: usernameSchema,
    password: passwordSchema,
    displayName: displayNameSchema.optional(),
    inviteCode: z.string().trim().min(1).max(64).optional(),
    ageConfirmed: z.literal(true),
    locale: localeSchema,
  }) as z.ZodType<IpcInput<'auth:register'>>,
  'auth:login': z.object({
    login: z.string().trim().min(1).max(254),
    password: z.string().min(1).max(256),
  }),
  'auth:login-second-factor': z.union([
    z.object({ code: totpCodeSchema }),
    z.object({ recoveryCode: recoveryCodeSchema }),
  ]),
  'auth:access-token': none,
  'auth:logout': none,
  'auth:forgot-password': z.object({ email: emailSchema }),
  'window:toggle-maximize': none,
};

type Handlers = { [C in IpcChannel]: (input: IpcInput<C>) => Promise<IpcOutput<C>> | IpcOutput<C> };

export interface IpcDependencies {
  readonly config: DesktopConfig;
  readonly auth: AuthAgent;
  readonly window: () => BrowserWindow | null;
}

function toError(error: unknown): IpcResult<never> {
  if (error instanceof ApiError) {
    const field = error.field === undefined ? {} : { field: error.field };
    return { ok: false, error: { code: error.code as never, message: error.message, ...field } };
  }
  return { ok: false, error: { code: 'INTERNAL', message: 'Unexpected error' } };
}

export function registerIpc(deps: IpcDependencies): void {
  const handlers: Handlers = {
    'config:get': () => deps.config,
    'auth:restore': () => deps.auth.restore(),
    'auth:register': (input) => deps.auth.register(input),
    'auth:login': ({ login, password }) => deps.auth.login(login, password),
    'auth:login-second-factor': (factor) => deps.auth.loginSecondFactor(factor),
    'auth:access-token': () => deps.auth.accessToken(),
    'auth:forgot-password': async ({ email }) => {
      await deps.auth.forgotPassword(email);
      return null;
    },
    'auth:logout': async () => {
      await deps.auth.logout();
      return null;
    },
    'window:toggle-maximize': () => {
      const window = deps.window();
      if (!window) return false;
      if (window.isMaximized()) window.unmaximize();
      else window.maximize();
      return window.isMaximized();
    },
  };

  for (const channel of IPC_CHANNELS) {
    ipcMain.handle(channel, async (event, raw: unknown): Promise<IpcResult<unknown>> => {
      if (!isTrustedSender(event))
        return { ok: false, error: { code: 'FORBIDDEN', message: 'Untrusted sender' } };
      const parsed = inputSchemas[channel].safeParse(raw);
      if (!parsed.success)
        return { ok: false, error: { code: 'VALIDATION_FAILED', message: 'Invalid input' } };
      try {
        const handler = handlers[channel] as (input: unknown) => unknown;
        return { ok: true, value: await handler(parsed.data) };
      } catch (error) {
        return toError(error);
      }
    });
  }
}
