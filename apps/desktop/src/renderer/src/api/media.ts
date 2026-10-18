import { type Upload, uploadOffsetSchema, uploadSchema } from '@silvercord/protocol';
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { DesktopError } from '../desktop.ts';
import {
  captureAccountGeneration,
  isCurrentAccountGeneration,
  requireAccountGeneration,
} from './account-generation.ts';
import { api, apiResponse, apiVoid } from './api-client.ts';

export type UploadStatus = 'uploading' | 'processing' | 'ready' | 'failed';

export interface PendingUpload {
  readonly localId: string;
  readonly channelId: string;
  readonly file: File;
  readonly status: UploadStatus;
  readonly progress: number;
  readonly upload: Upload | null;
  readonly error: string | null;
}

interface UploadsState {
  readonly items: PendingUpload[];
  patch(localId: string, change: Partial<PendingUpload>): void;
  remove(localId: string): void;
  clearChannel(channelId: string): void;
  reset(): void;
}

export const useUploads = create<UploadsState>()((set) => ({
  items: [],
  patch: (localId, change) =>
    set((state) => ({
      items: state.items.map((item) => (item.localId === localId ? { ...item, ...change } : item)),
    })),
  remove: (localId) =>
    set((state) => ({ items: state.items.filter((item) => item.localId !== localId) })),
  clearChannel: (channelId) =>
    set((state) => ({ items: state.items.filter((item) => item.channelId !== channelId) })),
  reset: () => set({ items: [] }),
}));

const controllers = new Map<string, AbortController>();
const POLL_MS = 600;

async function waitUntilProcessed(uploadId: string, signal: AbortSignal): Promise<Upload> {
  for (;;) {
    const upload = await api(uploadSchema, `/api/v1/uploads/${uploadId}`, { signal });
    if (upload.state !== 'processing') return upload;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

/** Streams the rest of `file` from the server's committed offset, one bounded chunk at a time. */
export async function sendChunks(
  upload: { readonly id: string; readonly offset: number; readonly chunkBytes: number },
  file: Blob,
  signal: AbortSignal,
  onProgress: (fraction: number) => void,
): Promise<void> {
  let offset = upload.offset;
  while (offset < file.size) {
    const end = Math.min(file.size, offset + upload.chunkBytes);
    const response = await api(uploadOffsetSchema, `/api/v1/uploads/${upload.id}/chunks`, {
      method: 'PUT',
      bytes: file.slice(offset, end),
      headers: { 'upload-offset': String(offset) },
      signal,
    });
    offset = response.offset;
    onProgress(offset / file.size);
  }
}

/** Reserves, streams chunks from the committed offset, completes and waits for processing. */
async function run(localId: string) {
  const { patch } = useUploads.getState();
  const item = useUploads.getState().items.find((candidate) => candidate.localId === localId);
  if (!item) return;
  const controller = new AbortController();
  controllers.set(localId, controller);
  try {
    let upload =
      item.upload ??
      (await api(uploadSchema, `/api/v1/channels/${item.channelId}/uploads`, {
        method: 'POST',
        body: { filename: item.file.name.slice(0, 128) || 'file', sizeBytes: item.file.size },
        signal: controller.signal,
      }));
    patch(localId, { upload, status: 'uploading', error: null });
    // Resume from what the server durably committed, not from what we think we sent.
    upload = await api(uploadSchema, `/api/v1/uploads/${upload.id}`, { signal: controller.signal });
    await sendChunks(upload, item.file, controller.signal, (progress) =>
      patch(localId, { progress }),
    );
    await api(uploadSchema, `/api/v1/uploads/${upload.id}/complete`, {
      method: 'POST',
      body: {},
      signal: controller.signal,
    });
    patch(localId, { status: 'processing', progress: 1 });
    const settled = await waitUntilProcessed(upload.id, controller.signal);
    patch(localId, {
      upload: settled,
      status: settled.state === 'ready' ? 'ready' : 'failed',
      error: settled.failure,
    });
  } catch (error) {
    if (controller.signal.aborted) return;
    patch(localId, {
      status: 'failed',
      error: error instanceof DesktopError ? error.code : 'NETWORK',
    });
  } finally {
    if (controllers.get(localId) === controller) controllers.delete(localId);
  }
}

export function addUploads(channelId: string, files: readonly File[]) {
  const created = files.map((file) => ({
    localId: crypto.randomUUID(),
    channelId,
    file,
    status: 'uploading' as const,
    progress: 0,
    upload: null,
    error: null,
  }));
  useUploads.setState((state) => ({ items: [...state.items, ...created] }));
  for (const item of created) void run(item.localId);
}

export function retryUpload(localId: string) {
  controllers.get(localId)?.abort();
  useUploads.getState().patch(localId, { status: 'uploading', error: null });
  void run(localId);
}

/** Cancels transfer and asks the server to discard the reservation. */
export function cancelUpload(localId: string) {
  controllers.get(localId)?.abort();
  const item = useUploads.getState().items.find((candidate) => candidate.localId === localId);
  useUploads.getState().remove(localId);
  if (item?.upload && item.status !== 'ready')
    void apiVoid(`/api/v1/uploads/${item.upload.id}`, { method: 'DELETE' }).catch(() => undefined);
}

/**
 * Authorized media bytes as account-scoped blob URLs (ADR-0009): the token never appears in a
 * URL and every URL is revoked on sign-out.
 */
const blobUrls = new Map<string, Promise<string>>();
const MAX_CACHED = 300;

export function mediaUrl(path: string): Promise<string> {
  const startedIn = captureAccountGeneration();
  let entry = blobUrls.get(path);
  if (!entry) {
    entry = apiResponse(path)
      .then((response) => response.blob())
      .then((blob) => {
        requireAccountGeneration(startedIn);
        return URL.createObjectURL(blob);
      });
    const current = entry;
    entry.catch(() => {
      if (blobUrls.get(path) === current) blobUrls.delete(path);
    });
    blobUrls.set(path, entry);
    if (blobUrls.size > MAX_CACHED) {
      const [oldest] = blobUrls.keys();
      if (oldest) {
        void blobUrls
          .get(oldest)
          ?.then((url) => URL.revokeObjectURL(url))
          .catch(() => undefined);
        blobUrls.delete(oldest);
      }
    }
  }
  return entry;
}

export function useMediaUrl(path: string | undefined): string | null {
  const [resolved, setResolved] = useState<{ path: string; url: string } | null>(null);
  useEffect(() => {
    if (!path) return;
    let live = true;
    const startedIn = captureAccountGeneration();
    void mediaUrl(path)
      .then((value) => {
        if (live && isCurrentAccountGeneration(startedIn)) setResolved({ path, url: value });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [path]);
  return resolved && path === resolved.path ? resolved.url : null;
}

export function forgetMedia() {
  for (const entry of blobUrls.values())
    void entry.then((url) => URL.revokeObjectURL(url)).catch(() => undefined);
  blobUrls.clear();
  for (const controller of controllers.values()) controller.abort();
  controllers.clear();
  useUploads.getState().reset();
}
