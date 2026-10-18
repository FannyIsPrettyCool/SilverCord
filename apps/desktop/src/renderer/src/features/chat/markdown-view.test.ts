import { parse } from '@silvercord/markdown';
import { describe, expect, it } from 'vitest';
import { isEmojiOnly } from './MarkdownView.tsx';

describe('jumbo expressions', () => {
  it('counts graphemes and ignores whitespace in combined emoji', () => {
    expect(isEmojiOnly(parse('👩🏽‍💻 ❤️ 🇫🇷 1️⃣'))).toBe(true);
    expect(isEmojiOnly(parse('😀 '.repeat(27)))).toBe(true);
    expect(isEmojiOnly(parse('😀 '.repeat(28)))).toBe(false);
  });
  it('keeps ordinary numbers, text, markdown and multiple paragraphs at text size', () => {
    for (const content of ['123', 'hello', '😀 hello', '**😀**', '😀\n\n😀', '#', '*'])
      expect(isEmojiOnly(parse(content))).toBe(false);
  });
});
