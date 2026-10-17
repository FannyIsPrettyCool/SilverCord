import { join } from 'node:path';
import { app, type BrowserWindow, Menu, nativeImage, Tray } from 'electron';

export const RESOURCES_DIR = join(import.meta.dirname, '../../resources');

/** Tray entry; item labels come from the OS locale until the renderer's i18n reaches main. */
export function createTray(window: () => BrowserWindow | null): Tray {
  const image = nativeImage.createFromPath(join(RESOURCES_DIR, 'tray.png'));
  const tray = new Tray(image);
  const french = app.getLocale().startsWith('fr');
  const show = () => {
    const current = window();
    if (!current) return;
    if (current.isMinimized()) current.restore();
    current.show();
    current.focus();
  };
  tray.setToolTip(app.getName());
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: french ? 'Ouvrir' : 'Open', click: show },
      { type: 'separator' },
      { label: french ? 'Quitter' : 'Quit', role: 'quit' },
    ]),
  );
  tray.on('click', show);
  return tray;
}
