/** The packaged renderer is served from this origin (custom protocol, BRIEF §8.2). */
export const APP_SCHEME = 'app';
export const APP_HOST = 'bundle';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

/**
 * In development electron-vite serves the renderer over HTTP with HMR. A packaged build ignores
 * the variable: otherwise anyone able to set the user's environment could load a remote page
 * with the full bridge (`process.defaultApp` is only set when running `electron <path>`).
 */
export const DEV_RENDERER_URL = process.defaultApp
  ? process.env['ELECTRON_RENDERER_URL']
  : undefined;

export const RENDERER_ORIGIN = DEV_RENDERER_URL ? new URL(DEV_RENDERER_URL).origin : APP_ORIGIN;

/** Chromium reports `app://bundle` for frames; use this for frame and permission origins. */
export function isRendererOrigin(origin: string | undefined | null): boolean {
  // Electron permission checks serialize custom origins with a trailing slash; frame origins
  // omit it. Accept those two serializations without treating arbitrary renderer URLs as origins.
  return origin === RENDERER_ORIGIN || origin === `${RENDERER_ORIGIN}/`;
}

/**
 * For URLs seen in the main process. Node's WHATWG `URL` gives custom schemes an opaque
 * origin (`"null"`), so the scheme and host are compared explicitly — never match `"null"`.
 */
export function isRendererUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (DEV_RENDERER_URL) return url.origin === RENDERER_ORIGIN;
  return url.protocol === `${APP_SCHEME}:` && url.host === APP_HOST;
}
