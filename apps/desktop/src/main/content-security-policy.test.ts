import { describe, expect, it } from 'vitest';
import { buildContentSecurityPolicy } from './content-security-policy.ts';

const config = {
  apiUrl: 'https://api.example.test',
  gatewayUrl: 'wss://api.example.test/gateway/v1',
  platform: 'linux',
  version: '0.0.0',
} as const;

describe('buildContentSecurityPolicy', () => {
  it('denies by default and only connects to the instance', () => {
    const csp = buildContentSecurityPolicy(config);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self';");
    expect(csp).toContain("connect-src 'self' https://api.example.test wss://api.example.test;");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain('unsafe-eval');
  });

  it('adds the dev server only in development', () => {
    const csp = buildContentSecurityPolicy(config, 'http://localhost:5173');
    expect(csp).toContain('ws://localhost:5173');
    expect(csp).toContain("script-src 'self' http://localhost:5173 'unsafe-inline'");
    expect(buildContentSecurityPolicy(config)).not.toMatch(/script-src[^;]*unsafe-inline/);
  });
});
