/** The packaged renderer is served from this origin (custom protocol, BRIEF §8.2). */
export const APP_SCHEME = 'app';
export const APP_HOST = 'bundle';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

/** In development electron-vite serves the renderer over HTTP with HMR. */
export const DEV_RENDERER_URL = process.env['ELECTRON_RENDERER_URL'];

export const RENDERER_ORIGIN = DEV_RENDERER_URL ? new URL(DEV_RENDERER_URL).origin : APP_ORIGIN;

export function isRendererOrigin(origin: string | undefined | null): boolean {
  return origin === RENDERER_ORIGIN;
}
