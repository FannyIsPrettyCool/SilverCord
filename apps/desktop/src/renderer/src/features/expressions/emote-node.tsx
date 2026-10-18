import { mergeAttributes, Node } from '@tiptap/core';
import { NodeViewWrapper, type ReactNodeViewProps, ReactNodeViewRenderer } from '@tiptap/react';
import { EmoteInline } from './EmoteImage.tsx';

function EmoteView({ node }: ReactNodeViewProps) {
  const id = String(node.attrs['id'] ?? '');
  const name = String(node.attrs['name'] ?? '');
  return (
    <NodeViewWrapper as="span" contentEditable={false}>
      <EmoteInline id={id} name={name} />
    </NodeViewWrapper>
  );
}

/** A custom emote inside the composer; serialized as `<:name:id>` (composer-markdown.ts). */
export const EmoteNode = Node.create({
  name: 'emote',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,
  addAttributes() {
    return {
      id: { default: null },
      name: { default: '' },
      animated: { default: false },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-emote]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes({ 'data-emote': '' }, HTMLAttributes)];
  },
  addNodeView() {
    return ReactNodeViewRenderer(EmoteView);
  },
});
