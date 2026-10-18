import type { BlockNode, Document, InlineNode } from './ast.ts';
import { type Budget, parseInlineText, rootContext } from './inline.ts';

export interface ParseOptions {
  /** Upper bound on non-text nodes; past it the rest of the message stays plain text. */
  readonly maxNodes?: number;
  /** Maximum inline nesting depth. */
  readonly maxDepth?: number;
}

export const DEFAULT_MAX_NODES = 2000;
export const DEFAULT_MAX_DEPTH = 8;

const FENCE = /^```([\w#+.-]{1,32})?[ \t]*$/;
const HEADING = /^(#{1,3}) (.+)$/;
const LIST_ITEM = /^ {0,3}(?:([-*])|(\d{1,9})\.) (.*)$/;

function isBlockStart(line: string): boolean {
  return (
    line.startsWith('```') || line.startsWith('>') || HEADING.test(line) || LIST_ITEM.test(line)
  );
}

function parseBlocks(lines: readonly string[], budget: Budget, allowQuote: boolean): BlockNode[] {
  const blocks: BlockNode[] = [];
  const inline = (text: string): InlineNode[] => parseInlineText(text, rootContext(budget));
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? '';

    if (line.startsWith('```')) {
      const opened = codeBlock(lines, index);
      if (opened) {
        blocks.push(opened.block);
        budget.nodes += 1;
        index = opened.next;
        continue;
      }
    }

    if (allowQuote && line.startsWith('>>> ')) {
      // Everything after `>>> ` is quoted, like Discord.
      const quoted = [line.slice(4), ...lines.slice(index + 1)];
      blocks.push({ type: 'quote', children: parseBlocks(quoted, budget, false) });
      budget.nodes += 1;
      break;
    }

    if (allowQuote && (line.startsWith('> ') || line === '>')) {
      const quoted: string[] = [];
      while (index < lines.length) {
        const current = lines[index] ?? '';
        if (current.startsWith('> ')) quoted.push(current.slice(2));
        else if (current === '>') quoted.push('');
        else break;
        index += 1;
      }
      blocks.push({ type: 'quote', children: parseBlocks(quoted, budget, false) });
      budget.nodes += 1;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading?.[1] && heading[2]) {
      const level = heading[1].length as 1 | 2 | 3;
      blocks.push({ type: 'heading', level, children: inline(heading[2]) });
      budget.nodes += 1;
      index += 1;
      continue;
    }

    const item = LIST_ITEM.exec(line);
    if (item) {
      const ordered = item[2] !== undefined;
      const start = ordered ? Number(item[2]) : 1;
      const items: InlineNode[][] = [];
      while (index < lines.length) {
        const current = LIST_ITEM.exec(lines[index] ?? '');
        if (!current || (current[2] !== undefined) !== ordered) break;
        items.push(inline(current[3] ?? ''));
        index += 1;
      }
      blocks.push({ type: 'list', ordered, start, items });
      budget.nodes += 1;
      continue;
    }

    const paragraph: string[] = [line];
    index += 1;
    while (index < lines.length && !isBlockStart(lines[index] ?? '')) {
      paragraph.push(lines[index] ?? '');
      index += 1;
    }
    blocks.push({ type: 'paragraph', children: inline(paragraph.join('\n')) });
  }
  return blocks;
}

function codeBlock(lines: readonly string[], start: number) {
  const first = lines[start] ?? '';
  const header = FENCE.exec(first);
  if (header) {
    for (let end = start + 1; end < lines.length; end += 1) {
      if ((lines[end] ?? '').trimEnd() === '```') {
        return {
          block: {
            type: 'codeBlock',
            language: header[1]?.toLowerCase() ?? null,
            value: lines.slice(start + 1, end).join('\n'),
          } satisfies BlockNode,
          next: end + 1,
        };
      }
    }
    return null;
  }
  // Single-line form: ```code``` on one line.
  const inlineMatch = /^```([\s\S]+?)```\s*$/.exec(first);
  if (inlineMatch?.[1]) {
    return {
      block: { type: 'codeBlock', language: null, value: inlineMatch[1] } satisfies BlockNode,
      next: start + 1,
    };
  }
  return null;
}

/** Parses chat markdown into a bounded AST. Pure, total (never throws), no HTML output. */
export function parse(source: string, options: ParseOptions = {}): Document {
  const budget: Budget = {
    nodes: 0,
    maxNodes: options.maxNodes ?? DEFAULT_MAX_NODES,
    maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
  };
  const normalized = source.replace(/\r\n?/g, '\n');
  return { type: 'document', children: parseBlocks(normalized.split('\n'), budget, true) };
}
