import { describe, expect, it } from 'vitest';
import { rewriteTokens } from './expressions-service.ts';

describe('expression token rewriting', () => {
  const usable = new Map([['10', { name: 'wave', animated: false }]]);
  it('keeps usable emotes (with their current name) and rewrites the rest', () => {
    expect(rewriteTokens('hi <:old_name:10> <a:party:20>', usable, new Set())).toBe(
      'hi <:wave:10> :party:',
    );
  });

  it('removes unusable stickers and keeps at most three', () => {
    const stickers = new Set(['1', '2', '3', '4']);
    expect(
      rewriteTokens('<sticker:1><sticker:9><sticker:2><sticker:3><sticker:4>', usable, stickers),
    ).toBe('<sticker:1><sticker:2><sticker:3>');
  });
});
