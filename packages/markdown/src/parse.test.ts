import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { BlockNode, Document, InlineNode } from './ast.ts';
import { parse } from './parse.ts';
import { allInlineNodes, mentionedUserIds, toPlainText } from './walk.ts';

const paragraph = (source: string): readonly InlineNode[] => {
  const [block] = parse(source).children;
  if (block?.type !== 'paragraph') throw new Error(`expected paragraph, got ${block?.type}`);
  return block.children;
};

function depth(nodes: readonly InlineNode[]): number {
  let max = 0;
  for (const node of nodes) if ('children' in node) max = Math.max(max, 1 + depth(node.children));
  return max;
}

function countNodes(document: Document): number {
  let count = 0;
  const visitBlocks = (blocks: readonly BlockNode[]) => {
    for (const block of blocks) {
      count += 1;
      if (block.type === 'quote') visitBlocks(block.children);
    }
  };
  visitBlocks(document.children);
  return count + allInlineNodes(document).filter((node) => node.type !== 'text').length;
}

describe('inline formatting', () => {
  it('parses emphasis, underline, strike, spoiler and code', () => {
    expect(paragraph('**b** *i* __u__ ~~s~~ ||x|| `c`')).toEqual([
      { type: 'strong', children: [{ type: 'text', value: 'b' }] },
      { type: 'text', value: ' ' },
      { type: 'em', children: [{ type: 'text', value: 'i' }] },
      { type: 'text', value: ' ' },
      { type: 'underline', children: [{ type: 'text', value: 'u' }] },
      { type: 'text', value: ' ' },
      { type: 'strike', children: [{ type: 'text', value: 's' }] },
      { type: 'text', value: ' ' },
      { type: 'spoiler', children: [{ type: 'text', value: 'x' }] },
      { type: 'text', value: ' ' },
      { type: 'code', value: 'c' },
    ]);
  });

  it('nests formatting and keeps code literal', () => {
    expect(paragraph('***both***')).toEqual([
      { type: 'strong', children: [{ type: 'em', children: [{ type: 'text', value: 'both' }] }] },
    ]);
    expect(paragraph('`**not bold** <@1>`')).toEqual([
      { type: 'code', value: '**not bold** <@1>' },
    ]);
  });

  it('does not italicize underscores inside words', () => {
    expect(paragraph('snake_case_name')).toEqual([{ type: 'text', value: 'snake_case_name' }]);
  });

  it('honors backslash escapes', () => {
    expect(paragraph('\\*literal\\*')).toEqual([{ type: 'text', value: '*literal*' }]);
  });

  it('keeps unmatched delimiters as text', () => {
    expect(paragraph('2 * 3 = 6 and **open')).toEqual([
      { type: 'text', value: '2 * 3 = 6 and **open' },
    ]);
  });

  it('turns newlines into breaks', () => {
    expect(paragraph('a\nb')).toEqual([
      { type: 'text', value: 'a' },
      { type: 'break' },
      { type: 'text', value: 'b' },
    ]);
  });
});

describe('links', () => {
  it('autolinks http(s) and trims trailing punctuation', () => {
    expect(paragraph('see https://example.com/a?b=1.')).toEqual([
      { type: 'text', value: 'see ' },
      {
        type: 'link',
        url: 'https://example.com/a?b=1',
        masked: false,
        children: [{ type: 'text', value: 'https://example.com/a?b=1' }],
      },
      { type: 'text', value: '.' },
    ]);
  });

  it('parses masked links without nesting links in the label', () => {
    expect(paragraph('[**docs** https://x.test](https://example.com)')).toEqual([
      {
        type: 'link',
        url: 'https://example.com/',
        masked: true,
        children: [
          { type: 'strong', children: [{ type: 'text', value: 'docs' }] },
          { type: 'text', value: ' https://x.test' },
        ],
      },
    ]);
  });

  it('refuses unsafe schemes and embedded credentials', () => {
    for (const source of [
      '[x](javascript:alert(1))',
      '[x](data:text/html,hi)',
      '[x](https://bank.example@evil.example)',
      '[x](file:///etc/passwd)',
    ]) {
      expect(allInlineNodes(parse(source)).some((node) => node.type === 'link')).toBe(false);
    }
  });
});

describe('mentions and timestamps', () => {
  it('recognizes user, role, channel, everyone and here', () => {
    expect(paragraph('<@123> <@!45> <@&6> <#7> @everyone @here')).toEqual([
      { type: 'mention', kind: 'user', id: '123' },
      { type: 'text', value: ' ' },
      { type: 'mention', kind: 'user', id: '45' },
      { type: 'text', value: ' ' },
      { type: 'mention', kind: 'role', id: '6' },
      { type: 'text', value: ' ' },
      { type: 'mention', kind: 'channel', id: '7' },
      { type: 'text', value: ' ' },
      { type: 'mention', kind: 'everyone', id: null },
      { type: 'text', value: ' ' },
      { type: 'mention', kind: 'here', id: null },
    ]);
  });

  it('ignores mentions inside words, code and out-of-range ids', () => {
    expect(mentionedUserIds(parse('mail@everyone.test `<@1>` <@99999999999999999999>'))).toEqual(
      [],
    );
    expect(allInlineNodes(parse('mail@everyone')).some((node) => node.type === 'mention')).toBe(
      false,
    );
  });

  it('extracts distinct mentioned users in order', () => {
    expect(mentionedUserIds(parse('<@2> hi <@1> **<@2>**\n> <@3>'))).toEqual(['2', '1', '3']);
  });

  it('parses timestamps with styles and rejects unrepresentable values', () => {
    expect(paragraph('<t:1700000000:R>')).toEqual([
      { type: 'timestamp', unix: 1_700_000_000, style: 'R' },
    ]);
    expect(paragraph('<t:1700000000>')).toEqual([
      { type: 'timestamp', unix: 1_700_000_000, style: 'f' },
    ]);
    expect(paragraph('<t:9999999999999>')).toEqual([{ type: 'text', value: '<t:9999999999999>' }]);
  });
});

describe('blocks', () => {
  it('parses fenced code with a language and keeps content literal', () => {
    expect(parse('```ts\nconst a = **1**;\n```').children).toEqual([
      { type: 'codeBlock', language: 'ts', value: 'const a = **1**;' },
    ]);
    expect(parse('```one line```').children).toEqual([
      { type: 'codeBlock', language: null, value: 'one line' },
    ]);
  });

  it('treats an unclosed fence as text', () => {
    expect(parse('```ts\nno end').children[0]?.type).toBe('paragraph');
  });

  it('parses quotes, multi-line quotes and headings', () => {
    expect(parse('> a\n> b\nc').children).toEqual([
      {
        type: 'quote',
        children: [
          {
            type: 'paragraph',
            children: [
              { type: 'text', value: 'a' },
              { type: 'break' },
              { type: 'text', value: 'b' },
            ],
          },
        ],
      },
      { type: 'paragraph', children: [{ type: 'text', value: 'c' }] },
    ]);
    expect(parse('>>> x\ny').children).toHaveLength(1);
    expect(parse('## Title').children).toEqual([
      { type: 'heading', level: 2, children: [{ type: 'text', value: 'Title' }] },
    ]);
    expect(parse('#hashtag').children[0]?.type).toBe('paragraph');
  });

  it('parses ordered and unordered lists', () => {
    expect(parse('- a\n- b').children).toEqual([
      {
        type: 'list',
        ordered: false,
        start: 1,
        items: [[{ type: 'text', value: 'a' }], [{ type: 'text', value: 'b' }]],
      },
    ]);
    expect(parse('3. x\n4. y').children[0]).toMatchObject({ ordered: true, start: 3 });
  });

  it('does not nest quotes', () => {
    const [quote] = parse('> > inner').children;
    expect(quote?.type).toBe('quote');
    if (quote?.type === 'quote') expect(quote.children[0]?.type).toBe('paragraph');
  });

  it('produces readable plain text with hidden spoilers', () => {
    expect(toPlainText(parse('**hi** ||secret|| `x`'))).toBe('hi ▮▮▮ x');
  });
});

describe('properties', () => {
  const chatAlphabet = fc.constantFrom(
    ...'ab *_~|`<>@#[]()\\\n>-1.:/thps'.split(''),
    'https://',
    '<@1>',
    '**',
    '```',
    '||',
    '@everyone',
    'é',
    '😀',
  );
  const chatText = fc.array(chatAlphabet, { maxLength: 300 }).map((parts) => parts.join(''));

  it('is total on arbitrary unicode input', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme', maxLength: 500 }), (source) => {
        expect(parse(source).type).toBe('document');
      }),
    );
    fc.assert(fc.property(chatText, (source) => void parse(source)));
  });

  it('respects the node and depth budgets', () => {
    fc.assert(
      fc.property(chatText, fc.integer({ min: 1, max: 50 }), (source, maxNodes) => {
        const document = parse(source, { maxNodes, maxDepth: 3 });
        // Each block may add one node past the budget check before stopping.
        expect(countNodes(document)).toBeLessThanOrEqual(maxNodes + document.children.length + 2);
        for (const block of document.children) {
          if (block.type === 'paragraph') expect(depth(block.children)).toBeLessThanOrEqual(5);
        }
      }),
    );
  });

  it('only ever emits safe absolute http(s) links', () => {
    fc.assert(
      fc.property(chatText, (source) => {
        for (const node of allInlineNodes(parse(source))) {
          if (node.type !== 'link') continue;
          const url = new URL(node.url);
          expect(['http:', 'https:']).toContain(url.protocol);
          expect(url.username + url.password).toBe('');
        }
      }),
    );
  });

  it('keeps plain prose unchanged', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[A-Za-z0-9 ,!?']{1,200}$/), (source) => {
        expect(parse(source).children).toEqual([
          { type: 'paragraph', children: [{ type: 'text', value: source }] },
        ]);
      }),
    );
  });

  it('parses adversarial 4000-character messages quickly', () => {
    for (const unit of ['*', '_', '**a', '[', '`', '||', '<@1', '~~', 'https://a.b/', '\\']) {
      const source = unit.repeat(Math.ceil(4000 / unit.length)).slice(0, 4000);
      const started = Date.now();
      parse(source);
      expect(Date.now() - started, unit).toBeLessThan(250);
    }
  });
});
