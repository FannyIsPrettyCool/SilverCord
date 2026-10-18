import { contextBridge, ipcRenderer } from 'electron';
import type { IpcChannel, IpcInput, IpcOutput, IpcResult } from '../shared/ipc-contract.ts';

function invoke<C extends IpcChannel>(
  channel: C,
  ...input: IpcInput<C> extends void ? [] : [IpcInput<C>]
) {
  return ipcRenderer.invoke(channel, ...input) as Promise<IpcResult<IpcOutput<C>>>;
}

/**
 * The renderer's whole view of the OS: named, typed calls, each validated again in main
 * (BRIEF §8.2). No generic `invoke`, no `ipcRenderer`, no Node.
 */
const bridge = {
  config: () => invoke('config:get'),
  auth: {
    restore: () => invoke('auth:restore'),
    register: (input: IpcInput<'auth:register'>) => invoke('auth:register', input),
    login: (input: IpcInput<'auth:login'>) => invoke('auth:login', input),
    loginSecondFactor: (input: IpcInput<'auth:login-second-factor'>) =>
      invoke('auth:login-second-factor', input),
    accessToken: () => invoke('auth:access-token'),
    logout: () => invoke('auth:logout'),
    forgotPassword: (input: IpcInput<'auth:forgot-password'>) =>
      invoke('auth:forgot-password', input),
  },
  window: {
    toggleMaximize: () => invoke('window:toggle-maximize'),
  },
  media: {
    download: (input: IpcInput<'media:download'>) => invoke('media:download', input),
  },
  activity: {
    configure: (input: IpcInput<'activity:configure'>) => invoke('activity:configure', input),
    snapshot: () => invoke('activity:snapshot'),
    games: () => invoke('activity:games'),
    setGames: (input: IpcInput<'activity:set-games'>) => invoke('activity:set-games', input),
    rpcApps: () => invoke('activity:rpc-apps'),
    decide: (input: IpcInput<'activity:rpc-decide'>) => invoke('activity:rpc-decide', input),
    forget: (input: IpcInput<'activity:rpc-forget'>) => invoke('activity:rpc-forget', input),
  },
} as const;

export type DesktopBridge = typeof bridge;

contextBridge.exposeInMainWorld('desktop', bridge);
