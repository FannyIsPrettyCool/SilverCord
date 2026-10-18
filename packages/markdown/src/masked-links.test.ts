import { expect, it } from 'vitest';
import { maskedLinks } from './masked-links.ts';

it('indexes labels with escaped closing delimiters', () => {
  const source = '[hello\\] world](https://example.test)';
  expect(maskedLinks(source).get(source.length)).toEqual({
    label: 'hello\\] world',
    url: 'https://example.test/',
    length: source.length,
  });
});

it('does not cross an unmatched closing bracket or a newline', () => {
  for (const source of [
    '[first] no link](https://example.test)',
    '[first\nsecond](https://example.test)',
  ])
    expect(maskedLinks(source).get(source.length)).toBeUndefined();
});

it('indexes a long opening-bracket label without rescanning every suffix', () => {
  const source = `${'['.repeat(3900)}](https://example.test)`;
  expect(maskedLinks(source).get(source.length)?.length).toBe(source.length);
});
