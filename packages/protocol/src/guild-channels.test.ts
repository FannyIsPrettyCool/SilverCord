import { describe, expect, it } from 'vitest';
import {
  guildChannelCreateSchema,
  guildChannelOrderSchema,
  guildChannelPatchSchema,
} from './guild-channels.ts';

describe('guild channel request boundaries', () => {
  it('permits only supported channel creation and category parents', () => {
    expect(guildChannelCreateSchema.safeParse({ type: 'thread', name: 'Thread' }).success).toBe(
      false,
    );
    expect(
      guildChannelCreateSchema.safeParse({
        type: 'guild_category',
        name: 'Category',
        parentId: '1',
      }).success,
    ).toBe(false);
    expect(
      guildChannelCreateSchema.parse({ type: 'guild_text', name: ' chat ', parentId: '1' }).name,
    ).toBe('chat');
    expect(
      guildChannelCreateSchema.safeParse({
        type: 'guild_text',
        name: 'Chat',
        topic: 'x'.repeat(1025),
      }).success,
    ).toBe(false);
  });
  it('requires a version and an actual change for patches', () => {
    expect(guildChannelPatchSchema.safeParse({ expectedVersion: 1 }).success).toBe(false);
    expect(guildChannelPatchSchema.safeParse({ name: 'Name' }).success).toBe(false);
    expect(guildChannelPatchSchema.parse({ topic: null, expectedVersion: 1 })).toEqual({
      topic: null,
      expectedVersion: 1,
    });
  });
  it('rejects duplicate channel ids and duplicate sibling positions', () => {
    expect(
      guildChannelOrderSchema.safeParse({
        expectedVersion: 1,
        items: [
          { id: '1', parentId: null, position: 0 },
          { id: '1', parentId: null, position: 1 },
        ],
      }).success,
    ).toBe(false);
    expect(
      guildChannelOrderSchema.safeParse({
        expectedVersion: 1,
        items: [
          { id: '1', parentId: null, position: 0 },
          { id: '2', parentId: null, position: 0 },
        ],
      }).success,
    ).toBe(false);
    expect(
      guildChannelOrderSchema.safeParse({
        expectedVersion: 1,
        items: [
          { id: '1', parentId: null, position: 0 },
          { id: '2', parentId: '1', position: 0 },
        ],
      }).success,
    ).toBe(true);
  });
});
