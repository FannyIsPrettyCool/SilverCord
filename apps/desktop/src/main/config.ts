import { app } from 'electron';
import type { DesktopConfig } from '../shared/ipc-contract.ts';

const DEVELOPMENT_API_URL = 'http://localhost:4000';
/** The owner's instance (docs/RUNBOOK.md); packaged builds connect here unless overridden. */
const PRODUCTION_API_URL = 'https://silvercord.islandmon.cloud';

function normalizePlatform(platform: NodeJS.Platform): DesktopConfig['platform'] {
  return platform === 'win32' || platform === 'linux' || platform === 'darwin' ? platform : 'other';
}

/**
 * Instance endpoints. Self-hosters point the client at their server with SILVERCORD_API_URL;
 * packaged builds default to the production instance, development builds to the local stack.
 */
export function loadConfig(): DesktopConfig {
  const fallback = app.isPackaged ? PRODUCTION_API_URL : DEVELOPMENT_API_URL;
  const apiUrl = new URL(process.env['SILVERCORD_API_URL'] ?? fallback);
  if (
    apiUrl.protocol !== 'https:' &&
    apiUrl.hostname !== 'localhost' &&
    apiUrl.hostname !== '127.0.0.1'
  ) {
    throw new Error('SILVERCORD_API_URL must use https outside localhost');
  }
  const gatewayUrl = new URL('/gateway/v1', apiUrl);
  gatewayUrl.protocol = apiUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  return {
    apiUrl: apiUrl.origin,
    gatewayUrl: gatewayUrl.toString(),
    platform: normalizePlatform(process.platform),
    version: app.getVersion(),
  };
}
