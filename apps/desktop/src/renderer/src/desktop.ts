import type { IpcResult } from '../../shared/ipc-contract.ts';

/** An IPC or API failure carrying the machine code the UI maps to copy. */
export class DesktopError extends Error {
  readonly code: string;
  /** Request field the server blamed (e.g. `email` on a conflict). */
  readonly field: string | undefined;
  constructor(code: string, message: string, field?: string) {
    super(message);
    this.name = 'DesktopError';
    this.code = code;
    this.field = field;
  }
}

export async function unwrap<T>(call: Promise<IpcResult<T>>): Promise<T> {
  const result = await call;
  if (!result.ok)
    throw new DesktopError(result.error.code, result.error.message, result.error.field);
  return result.value;
}

export const desktop = () => window.desktop;
