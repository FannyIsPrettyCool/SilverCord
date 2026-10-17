import { isRendererOrigin } from '../app-origin.ts';

interface FrameLike {
  readonly origin: string;
  readonly parent: unknown;
}

/**
 * Only the app's own top-level renderer frame may call in: subframes, other origins and frames
 * that have gone away are refused (Electron security recommendation 17).
 */
export function isTrustedSender(event: { readonly senderFrame: FrameLike | null }): boolean {
  const frame = event.senderFrame;
  return frame !== null && frame.parent === null && isRendererOrigin(frame.origin);
}
