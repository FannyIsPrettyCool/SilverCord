import { app } from 'electron';
import type { DesktopConfig } from '../shared/ipc-contract.ts';

const DEFAULT_API_URL = 'http://localhost:4000';

function normalizePlatform(platform: NodeJS.Platform): DesktopConfig['platform'] {
  return platform === 'win32' || platform === 'linux' || platform === 'darwin' ? platform : 'other';
}

/**
 * Instance endpoints. Self-hosters point the client at their server with SILVERCORD_API_URL;
 * the build-time default targets the local dev stack until a domain exists (ADR-0001).
 */
export function loadConfig(): DesktopConfig {
  const apiUrl = new URL(process.env['SILVERCORD_API_URL'] ?? DEFAULT_API_URL);
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
