import { join } from 'node:path';
import { BRAND } from '@silvercord/protocol/brand';
import { app, type BrowserWindow, session } from 'electron';
import { createActivityHub } from './activity/activity-hub.ts';
import { createAuthAgent } from './auth/auth-agent.ts';
import { createTokenStore } from './auth/token-store.ts';
import { loadConfig } from './config.ts';
import { registerIpc } from './ipc/register-ipc.ts';
import {
  hardenSession,
  hardenWebContents,
  registerAppScheme,
  serveRendererBundle,
} from './security.ts';
import { createTray, RESOURCES_DIR } from './tray.ts';
import { createMainWindow } from './window.ts';

// Wayland when available, X11 otherwise (BRIEF §7.4); must be set before `ready`.
if (process.platform === 'linux') app.commandLine.appendSwitch('ozone-platform-hint', 'auto');

app.setName(BRAND.name);
registerAppScheme();
hardenWebContents();

let mainWindow: BrowserWindow | null = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  void app.whenReady().then(() => {
    app.setAppUserModelId(BRAND.appId);
    const config = loadConfig();
    hardenSession(session.defaultSession, config);
    serveRendererBundle();
    const activity = createActivityHub({
      userData: app.getPath('userData'),
      resources: RESOURCES_DIR,
    });
    app.on('will-quit', () => void activity.close());
    registerIpc({
      config,
      auth: createAuthAgent(config.apiUrl, createTokenStore()),
      window: () => mainWindow,
      activity,
    });

    mainWindow = createMainWindow(join(RESOURCES_DIR, 'icon.png'));
    mainWindow.on('closed', () => {
      mainWindow = null;
    });
    createTray(() => mainWindow);
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
