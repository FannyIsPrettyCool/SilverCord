import type { BlockNode, Document, InlineNode } from './ast.ts';

function* inlineNodes(nodes: readonly InlineNode[]): Generator<InlineNode> {
  for (const node of nodes) {
    yield node;
    if ('children' in node) yield* inlineNodes(node.children);
  }
}

function* blockInlines(blocks: readonly BlockNode[]): Generator<InlineNode> {
  for (const block of blocks) {
    switch (block.type) {
      case 'paragraph':
      case 'heading':
        yield* inlineNodes(block.children);
        break;
      case 'quote':
        yield* blockInlines(block.children);
        break;
      case 'list':
        for (const item of block.items) yield* inlineNodes(item);
        break;
      case 'codeBlock':
        break;
    }
  }
}

/** Every inline node in document order (code blocks contribute none). */
export function allInlineNodes(document: Document): InlineNode[] {
  return [...blockInlines(document.children)];
}

/** Distinct user ids mentioned through recognized mention nodes, in first-seen order. */
export function mentionedUserIds(document: Document): string[] {
  const ids = new Set<string>();
  for (const node of blockInlines(document.children)) {
    if (node.type === 'mention' && node.kind === 'user' && node.id) ids.add(node.id);
  }
  return [...ids];
}

function inlineText(nodes: readonly InlineNode[]): string {
  let text = '';
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
      case 'code':
        text += node.value;
        break;
      case 'break':
        text += '\n';
        break;
      case 'mention':
        text += node.kind === 'everyone' || node.kind === 'here' ? `@${node.kind}` : '@…';
        break;
      case 'timestamp':
        text += new Date(node.unix * 1000).toISOString();
        break;
      case 'spoiler':
        text += '▮▮▮';
        break;
      case 'emote':
        text += `:${node.name}:`;
        break;
      case 'sticker':
        break;
      default:
        text += inlineText(node.children);
    }
  }
  return text;
}

function blockText(block: BlockNode): string {
  switch (block.type) {
    case 'paragraph':
    case 'heading':
      return inlineText(block.children);
    case 'quote':
      return block.children.map(blockText).join('\n');
    case 'list':
      return block.items.map(inlineText).join('\n');
    default:
      return block.value;
  }
}

/** Plain text for excerpts and notifications; spoilers stay hidden. */
export function toPlainText(document: Document): string {
  return document.children.map(blockText).join('\n');
}

/** Emote and sticker ids used outside code, in first-seen order (docs/spec/expressions.md). */
export function expressionIds(document: Document): { emotes: string[]; stickers: string[] } {
  const emotes = new Set<string>();
  const stickers = new Set<string>();
  for (const node of blockInlines(document.children)) {
    if (node.type === 'emote') emotes.add(node.id);
    else if (node.type === 'sticker') stickers.add(node.id);
  }
  return { emotes: [...emotes], stickers: [...stickers] };
}
