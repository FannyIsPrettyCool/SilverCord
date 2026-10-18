import { safeLinkUrl } from './links.ts';

interface MaskedLink {
  readonly label: string;
  readonly url: string;
  readonly length: number;
}

/**
 * Index potential masked links once. Trying the label regex again at every unmatched '['
 * scans the same suffix quadratically (e.g. a message made entirely of opening brackets).
 * Each opening bracket uses the nearest unescaped closing bracket before an unescaped newline.
 */
export function maskedLinks(source: string): ReadonlyMap<number, MaskedLink> {
  const found = new Map<number, MaskedLink>();
  if (!source.includes('](')) return found;
  const escaped = new Uint8Array(source.length);
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\\') {
      index += 1;
      if (index < source.length) escaped[index] = 1;
    }
  }
  let closing = -1;
  let tail: { url: string; length: number } | null = null;
  for (let index = source.length - 1; index >= 0; index -= 1) {
    if (escaped[index]) continue;
    const character = source[index];
    if (character === '\n') {
      closing = -1;
      tail = null;
    } else if (character === ']') {
      closing = index;
      const match = /^\]\(\s*<?([^\s<>()]+)>?\s*\)/.exec(source.slice(index));
      const url = match?.[1] ? safeLinkUrl(match[1]) : null;
      tail = match && url ? { url, length: match[0].length } : null;
    } else if (character === '[' && tail && closing > index + 1) {
      found.set(source.length - index, {
        label: source.slice(index + 1, closing),
        url: tail.url,
        length: closing - index + tail.length,
      });
    }
  }
  return found;
}
