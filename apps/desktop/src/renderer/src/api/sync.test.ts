import { afterEach, expect, it, vi } from 'vitest';
import { keys, queryClient } from './query-client.ts';
import { handleDispatch, reconcile, resetSync } from './sync.ts';

afterEach(() => {
  resetSync();
  queryClient.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('rechecks guild access and visible channels after either membership event', () => {
  vi.useFakeTimers();
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();
  handleDispatch('GUILD_CHANGED', { eventId: '10', guildId: '20' });
  handleDispatch('GUILD_CHANGED', { eventId: '10', guildId: '20' });
  handleDispatch('GUILD_MEMBERS_CHANGED', { eventId: '11', guildId: '20' });
  vi.advanceTimersByTime(200);
  expect(invalidate.mock.calls.map(([filter]) => filter?.queryKey)).toEqual([
    keys.guild('20'),
    keys.guildChannels('20'),
    keys.guildExpressions('20'),
    keys.guild('20'),
    keys.guildChannels('20'),
    keys.guildExpressions('20'),
    keys.guilds,
  ]);
});

it('ignores malformed guild events and reconciles all active guild views after recovery', () => {
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();
  handleDispatch('GUILD_CHANGED', { eventId: '10', guildId: 'not-an-id' });
  expect(invalidate).not.toHaveBeenCalled();
  reconcile();
  expect(invalidate).toHaveBeenCalledWith({ queryKey: keys.guilds });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['guild'] });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: keys.guildChannels() });
});
