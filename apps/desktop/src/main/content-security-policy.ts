import type { DesktopConfig } from '../shared/ipc-contract.ts';

/**
 * Strict CSP for the renderer (BRIEF §8.2). Network access is limited to the configured API and
 * gateway; user media will come from the CDN origin in phase 2.
 */
export function buildContentSecurityPolicy(
  config: DesktopConfig,
  devServerOrigin?: string,
): string {
  const dev = devServerOrigin ? [devServerOrigin, devServerOrigin.replace(/^http/, 'ws')] : [];
  const directives: Record<string, string[]> = {
    'default-src': ["'none'"],
    'script-src': ["'self'"],
    // Motion and CSS variables set inline styles at runtime.
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:'],
    'font-src': ["'self'"],
    'connect-src': ["'self'", config.apiUrl, new URL(config.gatewayUrl).origin, ...dev],
    'media-src': ["'self'", 'blob:'],
    'worker-src': ["'self'", 'blob:'],
    'object-src': ["'none'"],
    'base-uri': ["'none'"],
    'form-action': ["'none'"],
    'frame-ancestors': ["'none'"],
    'frame-src': ["'none'"],
  };
  if (devServerOrigin) {
    // Vite's React refresh preamble is an inline script. Development only: the packaged app
    // never passes a dev origin, and an e2e test asserts the production policy.
    directives['script-src']?.push(devServerOrigin, "'unsafe-inline'");
  }
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ');
}
