import { app } from 'electron';
import type { DesktopConfig } from '../shared/ipc-contract.ts';

const DEVELOPMENT_API_URL = 'http://localhost:4000';
/** The owner's instance (docs/RUNBOOK.md); packaged builds connect here unless overridden. */
const PRODUCTION_API_URL = 'https://silvercord.islandmon.cloud';
const PRODUCTION_MEDIA_URL = 'https://cdn.silvercord.islandmon.cloud';

/** Tokens may travel only to HTTPS origins, or HTTP on an explicit loopback endpoint. */
function endpoint(variable: string, fallback: string): URL {
  const url = new URL(process.env[variable] ?? fallback);
  const loopback =
    url.hostname === 'localhost' ||
    url.hostname === '[::1]' ||
    /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
    url.username !== '' ||
    url.password !== ''
  )
    throw new Error(`${variable} must use https outside loopback and omit credentials`);
  return url;
}

function normalizePlatform(platform: NodeJS.Platform): DesktopConfig['platform'] {
  return platform === 'win32' || platform === 'linux' || platform === 'darwin' ? platform : 'other';
}

/**
 * Instance endpoints. Self-hosters can set SILVERCORD_API_URL and SILVERCORD_MEDIA_URL;
 * the owner's instance serves private media through its separate authenticated CDN origin.
 */
export function loadConfig(): DesktopConfig {
  const fallback = app.isPackaged ? PRODUCTION_API_URL : DEVELOPMENT_API_URL;
  const apiUrl = endpoint('SILVERCORD_API_URL', fallback);
  const mediaUrl = endpoint(
    'SILVERCORD_MEDIA_URL',
    apiUrl.origin === PRODUCTION_API_URL ? PRODUCTION_MEDIA_URL : apiUrl.origin,
  );
  const gatewayUrl = new URL('/gateway/v1', apiUrl);
  gatewayUrl.protocol = apiUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  return {
    apiUrl: apiUrl.origin,
    mediaUrl: mediaUrl.origin,
    gatewayUrl: gatewayUrl.toString(),
    platform: normalizePlatform(process.platform),
    version: app.getVersion(),
  };
}
