import { describe, expect, it } from 'vitest';
import {
  bioSchema,
  customStatusRequestSchema,
  profilePatchSchema,
  pronounsSchema,
  statusEmojiSchema,
  summariesQuerySchema,
} from './profiles.ts';

describe('profile contracts', () => {
  it('accepts emoji sequences and custom emotes as a status emoji', () => {
    for (const emoji of ['🌙', '👩🏽‍💻', '🏳️‍🌈', '🇫🇷', '#️⃣', 'custom:1234567890'])
      expect(statusEmojiSchema.safeParse(emoji).success, emoji).toBe(true);
    for (const emoji of ['a', '🌙 hi', '', 'custom:x', '<script>'])
      expect(statusEmojiSchema.safeParse(emoji).success, emoji).toBe(false);
  });

  it('normalizes bios and bounds them by code points and lines', () => {
    expect(bioSchema.parse('  hi\r\nthere  ')).toBe('hi\nthere');
    expect(bioSchema.safeParse('é'.repeat(400)).success).toBe(true);
    expect(bioSchema.safeParse('é'.repeat(401)).success).toBe(false);
    expect(bioSchema.safeParse(Array(13).fill('x').join('\n')).success).toBe(false);
    expect(bioSchema.safeParse('right‮left').success).toBe(false);
  });

  it('rejects invisible formatting in pronouns', () => {
    expect(pronounsSchema.parse(' she/they ')).toBe('she/they');
    expect(pronounsSchema.safeParse('she​').success).toBe(false);
    expect(pronounsSchema.safeParse('x'.repeat(41)).success).toBe(false);
  });

  it('needs text or an emoji for a custom status', () => {
    expect(
      customStatusRequestSchema.safeParse({ text: '  ', emoji: null, expiresAt: null }).success,
    ).toBe(false);
    expect(
      customStatusRequestSchema.safeParse({ text: null, emoji: '🌙', expiresAt: null }).success,
    ).toBe(true);
  });

  it('requires a field beside the version in a patch', () => {
    expect(profilePatchSchema.safeParse({ version: 1 }).success).toBe(false);
    expect(profilePatchSchema.safeParse({ version: 1, bio: null }).success).toBe(true);
    expect(profilePatchSchema.safeParse({ version: 1, accentColor: 0x1000000 }).success).toBe(
      false,
    );
  });

  it('caps summary queries at 100 unique ids', () => {
    const ids = Array.from({ length: 101 }, (_, index) => String(index + 1));
    expect(summariesQuerySchema.safeParse({ userIds: ids.join(',') }).success).toBe(false);
    expect(summariesQuerySchema.safeParse({ userIds: '1,1' }).success).toBe(false);
    expect(summariesQuerySchema.parse({ userIds: '1,2' }).userIds).toEqual(['1', '2']);
  });
});
