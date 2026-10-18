import { DesktopError } from '../../desktop.ts';
import { errorKey } from '../chat/error-key.ts';

export function guildErrorKey(error: unknown) {
  return error instanceof DesktopError && error.code === 'NOT_FOUND'
    ? 'guilds.unavailable'
    : errorKey(error);
}
