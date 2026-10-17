import { join } from 'node:path';
import { BrowserWindow, shell } from 'electron';

const devRendererUrl = process.env['ELECTRON_RENDERER_URL'];

/** True when `url` belongs to the app's own renderer (dev server or packaged file). */
function isAppUrl(url: string): boolean {
  if (devRendererUrl) return new URL(url).origin === new URL(devRendererUrl).origin;
  return new URL(url).protocol === 'file:';
}

function isSafeExternalUrl(url: string): boolean {
  const protocol = new URL(url).protocol;
  return protocol === 'https:' || protocol === 'http:';
}

export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 940,
    minHeight: 560,
    show: false,
    backgroundColor: '#0A0C16',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  window.once('ready-to-show', () => window.show());

  // Deny every popup; validated http(s) links go to the OS browser instead.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  });

  if (devRendererUrl) {
    void window.loadURL(devRendererUrl);
  } else {
    void window.loadFile(join(import.meta.dirname, '../renderer/index.html'));
  }
  return window;
}
