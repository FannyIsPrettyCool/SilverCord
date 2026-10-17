import {
  type AuthTokens,
  authTokensSchema,
  type ErrorCode,
  errorEnvelopeSchema,
} from '@silvercord/protocol';
import { sql } from 'drizzle-orm';
import type { LightMyRequestResponse } from 'fastify';
import { expect } from 'vitest';
import type { TestApp } from './test-app.ts';

let counter = 0;

export function newAccount(overrides: Record<string, unknown> = {}) {
  counter += 1;
  return {
    email: `user${counter}-${Date.now()}@example.test`,
    username: `user${counter}_${Date.now() % 100_000}`,
    password: 'correct horse battery staple',
    ageConfirmed: true,
    locale: 'en',
    deviceName: 'Test Desktop',
    ...overrides,
  };
}

export function bearer(tokens: Pick<AuthTokens, 'accessToken'>) {
  return { authorization: `Bearer ${tokens.accessToken}` };
}

export function expectError(response: LightMyRequestResponse, status: number, code: ErrorCode) {
  expect(response.statusCode, response.body).toBe(status);
  expect(errorEnvelopeSchema.parse(response.json()).error.code).toBe(code);
}

export async function register(t: TestApp, overrides: Record<string, unknown> = {}) {
  const account = newAccount(overrides);
  const response = await t.request({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: account,
  });
  expect(response.statusCode, response.body).toBe(201);
  return { account, tokens: authTokensSchema.parse(response.json()) };
}

/** Opens the instance so tests that don't care about invites can register freely. */
export async function openRegistration(t: TestApp) {
  await t.context.database.db.execute(sql`update instance_settings set registration_mode = 'open'`);
}

export function tokenFromLink(text: string): string {
  const match = /token=([^\s&]+)/.exec(text);
  if (!match?.[1]) throw new Error(`no token link in: ${text}`);
  return decodeURIComponent(match[1]);
}
