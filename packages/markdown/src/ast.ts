/** Chat-markdown AST (docs/spec/messaging.md). Renderers map nodes to elements, never HTML. */

export type MentionKind = 'user' | 'role' | 'channel' | 'everyone' | 'here';

export const TIMESTAMP_STYLES = ['t', 'T', 'd', 'D', 'f', 'F', 'R'] as const;
export type TimestampStyle = (typeof TIMESTAMP_STYLES)[number];

export type InlineNode =
  | { readonly type: 'text'; readonly value: string }
  | { readonly type: 'strong'; readonly children: readonly InlineNode[] }
  | { readonly type: 'em'; readonly children: readonly InlineNode[] }
  | { readonly type: 'underline'; readonly children: readonly InlineNode[] }
  | { readonly type: 'strike'; readonly children: readonly InlineNode[] }
  | { readonly type: 'spoiler'; readonly children: readonly InlineNode[] }
  | { readonly type: 'code'; readonly value: string }
  /** `url` is an absolute http(s) URL; masked links keep their visible label as children. */
  | {
      readonly type: 'link';
      readonly url: string;
      readonly masked: boolean;
      readonly children: readonly InlineNode[];
    }
  /** `id` is a snowflake string for user/role/channel, null for everyone/here. */
  | { readonly type: 'mention'; readonly kind: MentionKind; readonly id: string | null }
  | { readonly type: 'timestamp'; readonly unix: number; readonly style: TimestampStyle }
  /** `<:name:id>` / `<a:name:id>` (docs/spec/expressions.md); `name` is the fallback text. */
  | {
      readonly type: 'emote';
      readonly id: string;
      readonly name: string;
      readonly animated: boolean;
    }
  /** `<sticker:id>` */
  | { readonly type: 'sticker'; readonly id: string }
  | { readonly type: 'break' };

export type BlockNode =
  | { readonly type: 'paragraph'; readonly children: readonly InlineNode[] }
  | {
      readonly type: 'heading';
      readonly level: 1 | 2 | 3;
      readonly children: readonly InlineNode[];
    }
  | { readonly type: 'quote'; readonly children: readonly BlockNode[] }
  | { readonly type: 'codeBlock'; readonly language: string | null; readonly value: string }
  | {
      readonly type: 'list';
      readonly ordered: boolean;
      readonly start: number;
      readonly items: readonly (readonly InlineNode[])[];
    };

export interface Document {
  readonly type: 'document';
  readonly children: readonly BlockNode[];
}
