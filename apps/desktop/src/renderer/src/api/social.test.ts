import { afterEach, expect, it, vi } from 'vitest';
import { advanceAccountGeneration } from './account-generation.ts';
import { api } from './api-client.ts';
import { fetchRelationships } from './social.ts';

vi.mock('./api-client.ts', () => ({ api: vi.fn(), apiVoid: vi.fn() }));
afterEach(() => vi.resetAllMocks());

it('loads older relationship pages beyond the first hundred', async () => {
  vi.mocked(api)
    .mockResolvedValueOnce({ items: [{ id: '200' }], nextBefore: '200' })
    .mockResolvedValueOnce({ items: [{ id: '100' }], nextBefore: null });
  expect(await fetchRelationships('friends')).toEqual([{ id: '200' }, { id: '100' }]);
  expect(vi.mocked(api).mock.calls[1]?.[1]).toBe(
    '/api/v1/users/@me/relationships?kind=friends&limit=100&before=200',
  );
});

it('never continues a paginated private list after the account changes', async () => {
  const pending = Promise.withResolvers<unknown>();
  vi.mocked(api).mockReturnValueOnce(pending.promise);
  const request = fetchRelationships('friends');
  const rejected = expect(request).rejects.toMatchObject({ name: 'AbortError' });
  advanceAccountGeneration();
  pending.resolve({ items: [{ id: '200' }], nextBefore: '200' });
  await rejected;
  expect(api).toHaveBeenCalledOnce();
});
