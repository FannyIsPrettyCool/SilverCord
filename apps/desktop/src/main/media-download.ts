import { writeFile } from 'node:fs/promises';
import { posix } from 'node:path';
import { type BrowserWindow, dialog } from 'electron';
import type { DesktopConfig } from '../shared/ipc-contract.ts';
import type { AuthAgent } from './auth/auth-agent.ts';

/** Only authorized media variant paths on the configured media origin (ADR-0009). */
export const MEDIA_PATH_PATTERN = /^\/media\/\d{1,19}\/(display|thumbnail|download)\/[a-f0-9]{64}$/;
const MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024;

/** Strips path separators and control characters; the user still picks the final location. */
export function safeFilename(name: string): string {
  // POSIX rules on every OS: Windows would read "a:b" as a drive prefix.
  const cleaned = posix
    .basename(name.replace(/\\/g, '/'))
    .replace(/[\p{Cc}\p{Cf}<>:"/\\|?*]/gu, '_')
    .replace(/^\.+/, '_')
    .slice(0, 128);
  return cleaned.length > 0 ? cleaned : 'download';
}

export async function downloadMedia(
  deps: { config: DesktopConfig; auth: AuthAgent; window: BrowserWindow | null },
  path: string,
  filename: string,
): Promise<boolean> {
  if (!MEDIA_PATH_PATTERN.test(path)) return false;
  const options = { defaultPath: safeFilename(filename) };
  const choice = deps.window
    ? await dialog.showSaveDialog(deps.window, options)
    : await dialog.showSaveDialog(options);
  if (choice.canceled || !choice.filePath) return false;
  const { accessToken } = await deps.auth.accessToken();
  const response = await fetch(new URL(path, deps.config.mediaUrl), {
    headers: { authorization: `Bearer ${accessToken}` },
    redirect: 'error',
  });
  if (!response.ok) return false;
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_DOWNLOAD_BYTES) return false;
  await writeFile(choice.filePath, bytes);
  return true;
}
