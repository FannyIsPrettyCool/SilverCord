import { errorEnvelopeSchema, MEDIA_PATH_PATTERN } from '@silvercord/protocol';
import type { z } from 'zod';
import type { DesktopConfig } from '../../../shared/ipc-contract.ts';
import { DesktopError, desktop, unwrap } from '../desktop.ts';
import {
  captureAccountGeneration,
  requireAccountGeneration,
  trackAccountRequest,
} from './account-generation.ts';

/** Refresh this long before the access token's stated expiry. */
const EXPIRY_MARGIN_MS = 30_000;

let configPromise: Promise<DesktopConfig> | null = null;
let cachedToken: { token: string; expiresAt: number } | null = null;

export function desktopConfig(): Promise<DesktopConfig> {
  configPromise ??= unwrap(desktop().config());
  return configPromise;
}

/** Access tokens come from the main process, which alone holds the refresh token. */
export async function accessToken(
  force = false,
  startedIn = captureAccountGeneration(),
): Promise<string> {
  requireAccountGeneration(startedIn);
  if (!force && cachedToken && cachedToken.expiresAt - EXPIRY_MARGIN_MS > Date.now())
    return cachedToken.token;
  const snapshot = await unwrap(desktop().auth.accessToken());
  requireAccountGeneration(startedIn);
  cachedToken = {
    token: snapshot.accessToken,
    expiresAt: Date.parse(snapshot.accessTokenExpiresAt),
  };
  return snapshot.accessToken;
}

/** Called on sign-out so a later account never reuses a previous token. */
export function forgetAccessToken(): void {
  cachedToken = null;
}

export interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
  /** Raw bytes for chunk uploads (sent as application/octet-stream). */
  readonly bytes?: Blob;
  readonly signal?: AbortSignal;
}

async function send(path: string, options: RequestOptions, token: string): Promise<Response> {
  const config = await desktopConfig();
  // Only protocol media paths may use the separately configured private media origin.
  const base = MEDIA_PATH_PATTERN.test(path) ? config.mediaUrl : config.apiUrl;
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Invalid API path');
  const target = new URL(path, base);
  if (target.origin !== new URL(base).origin) throw new Error('Invalid API path');
  const headers: Record<string, string> = { authorization: `Bearer ${token}`, ...options.headers };
  let body: BodyInit | undefined;
  if (options.bytes) {
    headers['content-type'] = 'application/octet-stream';
    body = options.bytes;
  } else if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  try {
    return await fetch(target, {
      method: options.method ?? 'GET',
      headers,
      ...(body === undefined ? {} : { body }),
      ...(options.signal ? { signal: options.signal } : {}),
      redirect: 'error',
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new DesktopError('NETWORK', 'Network unavailable');
  }
}

async function failure(response: Response): Promise<DesktopError> {
  const parsed = errorEnvelopeSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) return new DesktopError('INTERNAL', `HTTP ${response.status}`);
  const { code, message, issues } = parsed.data.error;
  return new DesktopError(code, message, issues?.[0]?.path);
}

/** Authenticated REST call; retries once with a fresh token after an expiry. */
export async function apiResponse(path: string, options: RequestOptions = {}): Promise<Response> {
  const startedIn = captureAccountGeneration();
  const controller = new AbortController();
  const release = trackAccountRequest(controller);
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;
  const scoped = { ...options, signal };
  try {
    if (signal.aborted) throw new DOMException('Request cancelled', 'AbortError');
    let response = await send(path, scoped, await accessToken(false, startedIn));
    requireAccountGeneration(startedIn);
    if (response.status === 401) {
      const error = await failure(response.clone());
      requireAccountGeneration(startedIn);
      if (error.code !== 'TOKEN_EXPIRED' && error.code !== 'TOKEN_INVALID') throw error;
      response = await send(path, scoped, await accessToken(true, startedIn));
      requireAccountGeneration(startedIn);
    }
    if (!response.ok) {
      const error = await failure(response);
      requireAccountGeneration(startedIn);
      throw error;
    }
    return response;
  } finally {
    release();
  }
}

/** JSON call parsed with the shared protocol schema; 204 responses yield undefined. */
export async function api<S extends z.ZodType>(
  schema: S,
  path: string,
  options: RequestOptions = {},
): Promise<z.infer<S>> {
  const startedIn = captureAccountGeneration();
  const response = await apiResponse(path, options);
  const json: unknown = await response.json();
  requireAccountGeneration(startedIn);
  return schema.parse(json);
}

export async function apiVoid(path: string, options: RequestOptions = {}): Promise<void> {
  await apiResponse(path, options);
}
