/** Minimal ProseMirror JSON shape produced by the composer's editor. */
export interface EditorNode {
  readonly type?: string | undefined;
  readonly text?: string | undefined;
  readonly attrs?: Record<string, unknown> | undefined;
  readonly marks?: readonly { readonly type: string }[] | undefined;
  readonly content?: readonly EditorNode[] | undefined;
}

/** Outermost first, so `***x***` round-trips as bold + italic. */
const MARK_DELIMITERS: readonly [string, string][] = [
  ['bold', '**'],
  ['italic', '*'],
  ['underline', '__'],
  ['strike', '~~'],
];

function textNode(node: EditorNode): string {
  const text = node.text ?? '';
  const marks = new Set((node.marks ?? []).map((mark) => mark.type));
  if (marks.has('code')) {
    // Pick a fence longer than any backtick run inside, padded when the text touches one.
    const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
    const fence = '`'.repeat(longest + 1);
    const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
    return `${fence}${pad}${text}${pad}${fence}`;
  }
  // Delimiters hug the text: whitespace stays outside or the markdown would not parse.
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
  const [, lead = '', core = '', trail = ''] = match ?? [];
  if (!core) return text;
  let wrapped = core;
  for (const [mark, delimiter] of [...MARK_DELIMITERS].reverse()) {
    if (marks.has(mark)) wrapped = `${delimiter}${wrapped}${delimiter}`;
  }
  return `${lead}${wrapped}${trail}`;
}

function inline(nodes: readonly EditorNode[] = []): string {
  return nodes
    .map((node) => {
      if (node.type === 'text') return textNode(node);
      if (node.type === 'hardBreak') return '\n';
      if (node.type === 'mention' && typeof node.attrs?.['id'] === 'string')
        return `<@${node.attrs['id']}>`;
      if (node.type === 'emote' && typeof node.attrs?.['id'] === 'string')
        return `<${node.attrs['animated'] === true ? 'a' : ''}:${String(node.attrs['name'])}:${node.attrs['id']}>`;
      return inline(node.content);
    })
    .join('');
}

/** Serializes the composer document into the chat-markdown subset the server parses. */
export function toChatMarkdown(document: EditorNode): string {
  return (document.content ?? []).map((block) => inline(block.content)).join('\n');
}
