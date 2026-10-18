import { describe, expect, it } from 'vitest';
import { channelPatchSchema, openChannelRequestSchema } from './channels.ts';
import {
  createMessageRequestSchema,
  editMessageRequestSchema,
  idempotencyHeadersSchema,
  MESSAGE_MAX_CODE_POINTS,
  messageSchema,
  reactionEmojiSchema,
} from './messages.ts';

describe('message contracts', () => {
  it('preserves whitespace and counts code points, not UTF-16 units', () => {
    expect(createMessageRequestSchema.parse({ content: '  hi\n\n' }).content).toBe('  hi\n\n');
    expect(
      createMessageRequestSchema.safeParse({ content: '😀'.repeat(MESSAGE_MAX_CODE_POINTS) })
        .success,
    ).toBe(true);
    expect(
      createMessageRequestSchema.safeParse({ content: '😀'.repeat(MESSAGE_MAX_CODE_POINTS + 1) })
        .success,
    ).toBe(false);
    expect(
      createMessageRequestSchema.safeParse({ content: 'a'.repeat(MESSAGE_MAX_CODE_POINTS) })
        .success,
    ).toBe(true);
    expect(
      createMessageRequestSchema.safeParse({ content: 'a'.repeat(MESSAGE_MAX_CODE_POINTS + 1) })
        .success,
    ).toBe(false);
  });

  it('refuses NUL and lone surrogates', () => {
    expect(createMessageRequestSchema.safeParse({ content: 'a\0b' }).success).toBe(false);
    expect(createMessageRequestSchema.safeParse({ content: '\uD800' }).success).toBe(false);
  });

  it('bounds unique attachments and rejects unknown fields', () => {
    const ids = Array.from({ length: 11 }, (_, index) => String(index + 1));
    expect(createMessageRequestSchema.safeParse({ attachmentIds: ids }).success).toBe(false);
    expect(createMessageRequestSchema.safeParse({ attachmentIds: ['1', '1'] }).success).toBe(false);
    expect(createMessageRequestSchema.safeParse({ content: 'x', authorId: '2' }).success).toBe(
      false,
    );
    expect(editMessageRequestSchema.safeParse({ content: 'x' }).success).toBe(false);
  });

  it('requires a v4 idempotency key', () => {
    expect(
      idempotencyHeadersSchema.safeParse({
        'idempotency-key': '0b8a5d36-4f3e-4c1a-9d2b-7e6f5a4b3c2d',
      }).success,
    ).toBe(true);
    expect(
      idempotencyHeadersSchema.safeParse({
        'idempotency-key': '0b8a5d36-4f3e-1c1a-9d2b-7e6f5a4b3c2d',
      }).success,
    ).toBe(false);
    expect(idempotencyHeadersSchema.safeParse({}).success).toBe(false);
  });

  it('accepts exactly one emoji sequence for reactions', () => {
    for (const emoji of ['👍', '👍🏽', '👨‍👩‍👧', '🇫🇷', '1️⃣', '❤️'])
      expect(reactionEmojiSchema.safeParse(emoji).success, emoji).toBe(true);
    for (const value of ['👍👍', 'a', '', ':smile:', '<:x:1>', '👍 '])
      expect(reactionEmojiSchema.safeParse(value).success, value).toBe(false);
  });

  it('discriminates hidden placeholders that carry no content', () => {
    const hidden = { id: '1', channelId: '2', hidden: true };
    expect(messageSchema.parse(hidden)).toEqual(hidden);
    expect(messageSchema.safeParse({ ...hidden, content: 'leak' }).success).toBe(false);
  });
});

describe('channel contracts', () => {
  it('distinguishes DM and group open requests', () => {
    expect(openChannelRequestSchema.parse({ recipientId: '5' })).toEqual({ recipientId: '5' });
    expect(openChannelRequestSchema.parse({ recipientIds: ['5', '6'], name: ' Crew ' })).toEqual({
      recipientIds: ['5', '6'],
      name: 'Crew',
    });
    for (const input of [
      { recipientIds: [] },
      { recipientIds: Array.from({ length: 25 }, (_, index) => String(index + 1)) },
      { recipientIds: ['5', '5'] },
      { recipientId: '5', name: 'x' },
    ])
      expect(openChannelRequestSchema.safeParse(input).success).toBe(false);
  });

  it('requires an expected version on rename', () => {
    expect(channelPatchSchema.safeParse({ name: 'x' }).success).toBe(false);
    expect(channelPatchSchema.parse({ name: null, expectedVersion: 3 }).name).toBeNull();
  });
});
