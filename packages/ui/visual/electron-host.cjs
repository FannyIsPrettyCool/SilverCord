// Minimal Electron host for visual tests: one fixed-size window, navigated by Playwright.
const { app, BrowserWindow } = require('electron');

app.whenReady().then(() => {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    useContentSize: true,
    show: true,
    backgroundColor: '#000000',
    webPreferences: { sandbox: true, contextIsolation: true },
  });
  window.loadURL('about:blank');
});
