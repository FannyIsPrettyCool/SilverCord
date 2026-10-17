import { isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, net, protocol, type Session, shell } from 'electron';
import type { DesktopConfig } from '../shared/ipc-contract.ts';
import {
  APP_HOST,
  APP_SCHEME,
  DEV_RENDERER_URL,
  isRendererOrigin,
  RENDERER_ORIGIN,
} from './app-origin.ts';
import { buildContentSecurityPolicy } from './content-security-policy.ts';

const RENDERER_ROOT = join(import.meta.dirname, '../renderer');

/** Must run before `app.ready` (Electron requirement for privileged schemes). */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
}

/**
 * Serves the built renderer from `app://bundle/` instead of `file://` (Electron security
 * recommendation 18). Paths escaping the bundle are refused; unknown paths fall back to the SPA
 * entry so client-side routes survive reloads.
 */
export function serveRendererBundle(): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.host !== APP_HOST) return new Response(null, { status: 404 });
    const target = resolve(RENDERER_ROOT, `.${decodeURIComponent(url.pathname)}`);
    const inside = relative(RENDERER_ROOT, target);
    if (inside.startsWith('..') || isAbsolute(inside)) return new Response(null, { status: 400 });
    const response = await net.fetch(pathToFileURL(target).toString()).catch(() => null);
    if (response?.ok) return response;
    return net.fetch(pathToFileURL(join(RENDERER_ROOT, 'index.html')).toString());
  });
}

function isSafeExternalUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'mailto:';
  } catch {
    return false;
  }
}

/** Permissions the renderer may ever get, and only for the app's own origin (BRIEF §8.2). */
const ALLOWED_PERMISSIONS = new Set([
  'media',
  'display-capture',
  'notifications',
  'clipboard-sanitized-write',
]);

export function hardenSession(session: Session, config: DesktopConfig): void {
  const csp = buildContentSecurityPolicy(config, DEV_RENDERER_URL ? RENDERER_ORIGIN : undefined);
  session.webRequest.onHeadersReceived((details, callback) => {
    const isRendererDocument = details.url.startsWith(RENDERER_ORIGIN);
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        ...(isRendererDocument
          ? {
              'Content-Security-Policy': [csp],
              'X-Content-Type-Options': ['nosniff'],
              'Cross-Origin-Opener-Policy': ['same-origin'],
            }
          : {}),
      },
    });
  });

  session.setPermissionRequestHandler((contents, permission, callback, details) => {
    const origin = new URL(details.requestingUrl || contents.getURL()).origin;
    callback(isRendererOrigin(origin) && ALLOWED_PERMISSIONS.has(permission));
  });
  session.setPermissionCheckHandler(
    (_contents, permission, requestingOrigin) =>
      isRendererOrigin(requestingOrigin) && ALLOWED_PERMISSIONS.has(permission),
  );
  // Nothing may be downloaded silently through the app session.
  session.on('will-download', (event) => event.preventDefault());
}

/** Applies to every web contents ever created: navigation, popups and webviews are locked. */
export function hardenWebContents(): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault());
    contents.on('will-navigate', (event, url) => {
      if (new URL(url).origin !== RENDERER_ORIGIN) event.preventDefault();
    });
    contents.on('will-redirect', (event, url) => {
      if (new URL(url).origin !== RENDERER_ORIGIN) event.preventDefault();
    });
    contents.setWindowOpenHandler(({ url }) => {
      if (isSafeExternalUrl(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
  });
}
