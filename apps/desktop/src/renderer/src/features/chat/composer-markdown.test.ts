import { mentionedUserIds, parse } from '@silvercord/markdown';
import { describe, expect, it } from 'vitest';
import { type EditorNode, toChatMarkdown } from './composer-markdown.ts';

const text = (value: string, ...marks: string[]): EditorNode => ({
  type: 'text',
  text: value,
  marks: marks.map((type) => ({ type })),
});
const doc = (...paragraphs: EditorNode[][]): EditorNode => ({
  type: 'doc',
  content: paragraphs.map((content) => ({ type: 'paragraph', content })),
});

describe('composer markdown', () => {
  it('serializes marks the server parser understands', () => {
    const markdown = toChatMarkdown(
      doc([text('hi '), text('bold', 'bold'), text(' '), text('both', 'bold', 'italic')]),
    );
    expect(markdown).toBe('hi **bold** ***both***');
    const [block] = parse(markdown).children;
    expect(block?.type === 'paragraph' && block.children[1]?.type).toBe('strong');
  });

  it('keeps whitespace outside delimiters', () => {
    expect(toChatMarkdown(doc([text('a'), text(' strong ', 'bold'), text('b')]))).toBe(
      'a **strong** b',
    );
  });

  it('fences inline code longer than any backtick run inside it', () => {
    expect(toChatMarkdown(doc([text('a`b', 'code')]))).toBe('``a`b``');
    expect(toChatMarkdown(doc([text('`x', 'code')]))).toBe('`` `x ``');
  });

  it('turns mentions and paragraphs into tokens and newlines', () => {
    const markdown = toChatMarkdown(
      doc(
        [text('hey '), { type: 'mention', attrs: { id: '42', label: 'tide' } }],
        [text('line two'), { type: 'hardBreak' }, text('three')],
      ),
    );
    expect(markdown).toBe('hey <@42>\nline two\nthree');
    expect(mentionedUserIds(parse(markdown))).toEqual(['42']);
  });

  it('leaves typed markdown syntax untouched for the receiver to parse', () => {
    expect(toChatMarkdown(doc([text('> quote ||spoiler||')]))).toBe('> quote ||spoiler||');
  });
});
