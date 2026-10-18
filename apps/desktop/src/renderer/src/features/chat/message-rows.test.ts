import type { Message } from '@silvercord/protocol';
import { describe, expect, it } from 'vitest';
import { buildRows, newestReadable } from './message-rows.ts';

const author = { id: '1', username: 'aurora', displayName: null };
const other = { id: '2', username: 'tide', displayName: null };
function message(id: string, at: string, by = author): Message {
  return {
    id,
    channelId: '9',
    hidden: false,
    author: by,
    content: id,
    mentions: [],
    reply: null,
    reactions: [],
    attachments: [],
    version: 1,
    createdAt: at,
    editedAt: null,
  };
}

describe('message rows', () => {
  it('orders oldest first, dedupes across pages and groups by author and time', () => {
    const rows = buildRows(
      [
        {
          items: [
            message('4', '2026-10-18T10:20:00Z', other),
            message('3', '2026-10-18T10:02:00Z'),
          ],
        },
        { items: [message('3', '2026-10-18T10:02:00Z'), message('2', '2026-10-18T10:01:00Z')] },
      ],
      [],
    );
    expect(rows.map((row) => row.key)).toEqual(['day-2026-10-18', '2', '3', '4']);
    expect(rows.map((row) => (row.kind === 'message' ? row.grouped : null))).toEqual([
      null,
      false,
      true,
      false,
    ]);
  });

  it('breaks groups at day boundaries and after the window', () => {
    const rows = buildRows(
      [
        {
          items: [
            message('3', '2026-10-19T00:01:00Z'),
            message('2', '2026-10-18T23:59:00Z'),
            message('1', '2026-10-18T23:40:00Z'),
          ],
        },
      ],
      [],
    );
    expect(rows.map((row) => row.key)).toEqual(['day-2026-10-18', '1', '2', 'day-2026-10-19', '3']);
    expect(rows.filter((row) => row.kind === 'message' && row.grouped)).toHaveLength(0);
  });

  it('finds the newest readable message, skipping hidden ones', () => {
    const rows = buildRows(
      [
        {
          items: [{ id: '5', channelId: '9', hidden: true }, message('4', '2026-10-18T10:00:00Z')],
        },
      ],
      [],
    );
    expect(newestReadable(rows)).toBe('4');
  });
});
