import { BRAND } from '@silvercord/protocol/brand';
import { app, BrowserWindow, session } from 'electron';
import { createMainWindow } from './window.ts';

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.on('second-instance', () => {
  const [window] = BrowserWindow.getAllWindows();
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.focus();
});

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault());
});

void app.whenReady().then(() => {
  app.setAppUserModelId(BRAND.appId);
  // Nothing needs device or notification access yet; phase 1 allow-lists media,
  // display-capture and notifications for the app origin only.
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
  createMainWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
