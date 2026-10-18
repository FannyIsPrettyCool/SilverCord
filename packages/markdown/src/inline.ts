import type { InlineNode, MentionKind, TimestampStyle } from './ast.ts';
import { safeLinkUrl } from './links.ts';

/** Shared parse budget: past either limit, the remainder renders as plain text. */
export interface Budget {
  nodes: number;
  readonly maxNodes: number;
  readonly maxDepth: number;
}

interface Context {
  readonly budget: Budget;
  readonly depth: number;
  /** Links are disabled inside masked-link labels so links never nest. */
  readonly links: boolean;
}

type Match = { readonly length: number; readonly nodes: readonly InlineNode[] };
type Rule = (rest: string, previous: string, context: Context) => Match | null;

const WORD = /[\p{L}\p{N}_]/u;

function wrap(
  type: 'strong' | 'em' | 'underline' | 'strike' | 'spoiler',
  match: RegExpExecArray,
  inner: string,
  context: Context,
): Match {
  const children = parseInlineText(inner, { ...context, depth: context.depth + 1 });
  return { length: match[0].length, nodes: [{ type, children }] };
}

function delimited(
  pattern: RegExp,
  type: 'strong' | 'em' | 'underline' | 'strike' | 'spoiler',
): Rule {
  return (rest, _previous, context) => {
    const match = pattern.exec(rest);
    return match?.[1] ? wrap(type, match, match[1], context) : null;
  };
}

function mention(kind: MentionKind, id: string | null, length: number): Match {
  return { length, nodes: [{ type: 'mention', kind, id }] };
}

const SNOWFLAKE_MAX = 18_446_744_073_709_551_615n;
const validId = (digits: string) => BigInt(digits) <= SNOWFLAKE_MAX && !/^0\d/.test(digits);

/** Timestamps outside ±8.64e12 s cannot be represented as a JS Date. */
const MAX_UNIX = 8_640_000_000_000;

const rules: readonly Rule[] = [
  // Backslash escapes any ASCII punctuation.
  (rest) => {
    const match = /^\\([!-/:-@[-`{-~])/.exec(rest);
    return match?.[1] ? { length: 2, nodes: [{ type: 'text', value: match[1] }] } : null;
  },
  (rest) => {
    const match = /^(`+)([\s\S]*?[^`])\1(?!`)/.exec(rest);
    if (!match?.[2]) return null;
    const raw = match[2];
    // Like CommonMark: one padding space on each side lets code start or end with a backtick.
    const value =
      raw.length > 2 && raw.startsWith(' ') && raw.endsWith(' ') ? raw.slice(1, -1) : raw;
    return { length: match[0].length, nodes: [{ type: 'code', value }] };
  },
  (rest) => {
    const match = /^<(@!?|@&|#)(\d{1,20})>/.exec(rest);
    if (!match?.[1] || !match[2] || !validId(match[2])) return null;
    const kind: MentionKind = match[1] === '#' ? 'channel' : match[1] === '@&' ? 'role' : 'user';
    return mention(kind, match[2], match[0].length);
  },
  (rest) => {
    const match = /^<t:(-?\d{1,13})(?::([tTdDfFR]))?>/.exec(rest);
    if (!match?.[1]) return null;
    const unix = Number(match[1]);
    if (Math.abs(unix) > MAX_UNIX) return null;
    const style = (match[2] ?? 'f') as TimestampStyle;
    return { length: match[0].length, nodes: [{ type: 'timestamp', unix, style }] };
  },
  (rest, previous) => {
    if (WORD.test(previous)) return null;
    const match = /^@(everyone|here)(?![\p{L}\p{N}_])/u.exec(rest);
    return match?.[1] ? mention(match[1] as 'everyone' | 'here', null, match[0].length) : null;
  },
  (rest, _previous, context) => {
    if (!context.links) return null;
    const match = /^\[((?:\\[\s\S]|[^\\\]\n])+)\]\(\s*<?([^\s<>()]+)>?\s*\)/.exec(rest);
    if (!match?.[1] || !match[2]) return null;
    const url = safeLinkUrl(match[2]);
    if (!url) return null;
    const children = parseInlineText(match[1], {
      ...context,
      depth: context.depth + 1,
      links: false,
    });
    return { length: match[0].length, nodes: [{ type: 'link', url, masked: true, children }] };
  },
  (rest, previous, context) => {
    if (!context.links || WORD.test(previous)) return null;
    const match = /^(<)?(https?:\/\/[^\s<>]*[^\s<>.,:;"'!?)\]])(>)?/i.exec(rest);
    if (!match?.[2]) return null;
    // `<https://…>` suppresses previews on Discord; here it only delimits the URL.
    const bracketed = match[1] !== undefined && match[3] !== undefined;
    const raw = match[2];
    const url = safeLinkUrl(raw);
    if (!url) return null;
    const length = bracketed ? raw.length + 2 : raw.length;
    if (!bracketed && match[1] !== undefined) return null;
    return {
      length,
      nodes: [{ type: 'link', url, masked: false, children: [{ type: 'text', value: raw }] }],
    };
  },
  delimited(/^\*\*([\s\S]+?)\*\*(?!\*)/, 'strong'),
  delimited(/^__([\s\S]+?)__(?!_)/, 'underline'),
  delimited(/^\*(?=\S)((?:\*\*|\\[\s\S]|[^\\*])+?)\*(?!\*)/, 'em'),
  (rest, previous, context) => {
    if (WORD.test(previous)) return null;
    const match = /^_((?:__|\\[\s\S]|[^\\_])+?)_(?![\p{L}\p{N}_])/u.exec(rest);
    return match?.[1] ? wrap('em', match, match[1], context) : null;
  },
  delimited(/^~~([\s\S]+?)~~/, 'strike'),
  delimited(/^\|\|([\s\S]+?)\|\|/, 'spoiler'),
  (rest) => (rest.startsWith('\n') ? { length: 1, nodes: [{ type: 'break' }] } : null),
];

/** Characters (or prefixes) where a non-text rule might start. */
const SPECIAL = /[\\`<@[*_~|\n]|https?:\/\//i;

function pushText(out: InlineNode[], value: string) {
  const last = out.at(-1);
  if (last?.type === 'text') out[out.length - 1] = { type: 'text', value: last.value + value };
  else out.push({ type: 'text', value });
}

/** Parses one inline run. Pure; never throws on any input. */
export function parseInlineText(source: string, context: Context): InlineNode[] {
  const out: InlineNode[] = [];
  const { budget } = context;
  let index = 0;
  while (index < source.length) {
    if (budget.nodes >= budget.maxNodes || context.depth > budget.maxDepth) {
      pushText(out, source.slice(index));
      break;
    }
    const rest = source.slice(index);
    const previous = index > 0 ? source.slice(Math.max(0, index - 2), index) : '';
    const lastChar = Array.from(previous).at(-1) ?? '';
    let matched: Match | null = null;
    for (const rule of rules) {
      matched = rule(rest, lastChar, context);
      if (matched) break;
    }
    if (matched) {
      for (const node of matched.nodes) {
        if (node.type === 'text') pushText(out, node.value);
        else {
          budget.nodes += 1;
          out.push(node);
        }
      }
      index += matched.length;
      continue;
    }
    // Plain text up to the next character where a rule could begin (at least one char).
    const next = rest.slice(1).search(SPECIAL);
    const length = next === -1 ? rest.length : next + 1;
    pushText(out, rest.slice(0, length));
    index += length;
  }
  return out;
}

export function rootContext(budget: Budget): Context {
  return { budget, depth: 0, links: true };
}
