import { release } from 'node:os';
import { join } from 'node:path';
import { BrowserWindow, type BrowserWindowConstructorOptions } from 'electron';
import { APP_ORIGIN, DEV_RENDERER_URL } from './app-origin.ts';

const TITLE_BAR_HEIGHT = 40;
/** Windows 11 22H2 (build 22621) is the first release with system backdrop materials. */
const WINDOWS_MATERIAL_MIN_BUILD = 22_621;

function windowsBuild(): number {
  return Number(release().split('.')[2] ?? 0);
}

/**
 * Frameless window with native window controls drawn over our own title bar
 * (`titleBarOverlay`, Windows and Linux). Windows 11 gets the Mica material; everywhere else the
 * in-app ambient layer provides the backdrop (BRIEF §7.4). `transparent: true` is avoided on
 * purpose: transparent windows lose resizing, maximize and native shadows.
 */
function platformOptions(): BrowserWindowConstructorOptions {
  const overlay = { color: '#00000000', symbolColor: '#E8ECFF', height: TITLE_BAR_HEIGHT };
  if (process.platform === 'win32') {
    return {
      titleBarStyle: 'hidden',
      titleBarOverlay: overlay,
      ...(windowsBuild() >= WINDOWS_MATERIAL_MIN_BUILD
        ? { backgroundMaterial: 'mica' as const }
        : {}),
    };
  }
  if (process.platform === 'linux') return { titleBarStyle: 'hidden', titleBarOverlay: overlay };
  return { titleBarStyle: 'hiddenInset' };
}

export function createMainWindow(icon: string): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 940,
    minHeight: 560,
    show: false,
    backgroundColor: '#0A0C16',
    icon,
    ...platformOptions(),
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      spellcheck: true,
    },
  });

  window.once('ready-to-show', () => window.show());
  if (DEV_RENDERER_URL) {
    // Surfaces renderer errors (CSP violations included) in the dev terminal.
    window.webContents.on('console-message', ({ level, message }) => {
      if (level === 'warning' || level === 'error')
        process.stderr.write(`[renderer ${level}] ${message}\n`);
    });
  }
  void window.loadURL(DEV_RENDERER_URL ?? `${APP_ORIGIN}/index.html`);
  return window;
}
