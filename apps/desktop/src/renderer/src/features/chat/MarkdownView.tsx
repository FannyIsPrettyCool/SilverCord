import {
  type BlockNode,
  type Document,
  type InlineNode,
  parse,
  type TimestampStyle,
} from '@silvercord/markdown';
import type { PublicUser } from '@silvercord/protocol';
import { type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './markdown.module.css';

export interface MarkdownContext {
  /** Cards for users the message may mention; unknown ids render as a neutral mention. */
  readonly users: ReadonlyMap<string, PublicUser>;
  readonly selfId: string | null;
}

const TIMESTAMP_FORMATS: Record<Exclude<TimestampStyle, 'R'>, Intl.DateTimeFormatOptions> = {
  t: { timeStyle: 'short' },
  T: { timeStyle: 'medium' },
  d: { dateStyle: 'short' },
  D: { dateStyle: 'long' },
  f: { dateStyle: 'long', timeStyle: 'short' },
  F: { dateStyle: 'full', timeStyle: 'short' },
};

function relative(date: Date, locale: string): string {
  const seconds = (date.getTime() - Date.now()) / 1000;
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['day', 86_400],
    ['hour', 3600],
    ['minute', 60],
    ['second', 1],
  ];
  const [unit, size] = units.find(([, size]) => Math.abs(seconds) >= size) ?? ['second', 1];
  return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(
    Math.round(seconds / size),
    unit,
  );
}

function Spoiler({ children }: { readonly children: ReactNode }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <button
      type="button"
      className={styles['spoiler']}
      data-open={open || undefined}
      aria-expanded={open}
      aria-label={open ? undefined : t('chat.spoiler')}
      onClick={() => setOpen(true)}
    >
      <span aria-hidden={!open}>{children}</span>
    </button>
  );
}

function Inline({
  nodes,
  context,
}: {
  readonly nodes: readonly InlineNode[];
  readonly context: MarkdownContext;
}) {
  const { i18n } = useTranslation();
  return nodes.map((node, index) => {
    const key = `${node.type}-${index}`;
    switch (node.type) {
      case 'text':
        return node.value;
      case 'break':
        return <br key={key} />;
      case 'code':
        return (
          <code key={key} className={styles['code']}>
            {node.value}
          </code>
        );
      case 'strong':
        return (
          <strong key={key}>
            <Inline nodes={node.children} context={context} />
          </strong>
        );
      case 'em':
        return (
          <em key={key}>
            <Inline nodes={node.children} context={context} />
          </em>
        );
      case 'underline':
        return (
          <u key={key}>
            <Inline nodes={node.children} context={context} />
          </u>
        );
      case 'strike':
        return (
          <s key={key}>
            <Inline nodes={node.children} context={context} />
          </s>
        );
      case 'spoiler':
        return (
          <Spoiler key={key}>
            <Inline nodes={node.children} context={context} />
          </Spoiler>
        );
      case 'link':
        // target=_blank goes through the main process, which validates and opens the OS browser.
        return (
          <a
            key={key}
            className={styles['link']}
            href={node.url}
            target="_blank"
            rel="noreferrer noopener"
            title={node.masked ? node.url : undefined}
          >
            <Inline nodes={node.children} context={context} />
          </a>
        );
      case 'mention': {
        const user = node.id ? context.users.get(node.id) : undefined;
        const label =
          node.kind === 'everyone' || node.kind === 'here'
            ? `@${node.kind}`
            : node.kind === 'channel'
              ? '#…'
              : `@${user?.displayName ?? user?.username ?? '…'}`;
        return (
          <span
            key={key}
            className={styles['mention']}
            data-self={node.id !== null && node.id === context.selfId ? true : undefined}
          >
            {label}
          </span>
        );
      }
      case 'timestamp': {
        const date = new Date(node.unix * 1000);
        const text =
          node.style === 'R'
            ? relative(date, i18n.language)
            : new Intl.DateTimeFormat(i18n.language, TIMESTAMP_FORMATS[node.style]).format(date);
        return (
          <time key={key} className={styles['timestamp']} dateTime={date.toISOString()}>
            {text}
          </time>
        );
      }
      default:
        return null;
    }
  });
}

function Block({
  block,
  context,
}: {
  readonly block: BlockNode;
  readonly context: MarkdownContext;
}) {
  switch (block.type) {
    case 'paragraph':
      return (
        <p className={styles['paragraph']}>
          <Inline nodes={block.children} context={context} />
        </p>
      );
    case 'heading': {
      const Heading = (['h3', 'h4', 'h5'] as const)[block.level - 1] ?? 'h5';
      return (
        <Heading className={styles['heading']} data-level={block.level}>
          <Inline nodes={block.children} context={context} />
        </Heading>
      );
    }
    case 'quote':
      return (
        <blockquote className={styles['quote']}>
          {block.children.map((child, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: AST nodes have no identity; content is immutable.
            <Block key={`${child.type}-${index}`} block={child} context={context} />
          ))}
        </blockquote>
      );
    case 'codeBlock':
      return (
        <pre className={styles['codeBlock']} data-language={block.language ?? undefined}>
          <code>{block.value}</code>
        </pre>
      );
    case 'list': {
      const List = block.ordered ? 'ol' : 'ul';
      return (
        <List className={styles['list']} start={block.ordered ? block.start : undefined}>
          {block.items.map((item, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: list items have no identity; content is immutable.
            <li key={`item-${index}`}>
              <Inline nodes={item} context={context} />
            </li>
          ))}
        </List>
      );
    }
    default:
      return null;
  }
}

/** Parsed documents by source text; virtualized rows re-mount often while scrolling. */
const parsed = new Map<string, Document>();
const PARSE_CACHE_LIMIT = 2000;

function parseCached(content: string): Document {
  let document = parsed.get(content);
  if (!document) {
    document = parse(content);
    parsed.set(content, document);
    if (parsed.size > PARSE_CACHE_LIMIT) {
      const [oldest] = parsed.keys();
      if (oldest !== undefined) parsed.delete(oldest);
    }
  }
  return document;
}

/** Renders chat markdown from its AST; there is no HTML path (docs/spec/messaging.md). */
export function MarkdownView({
  content,
  context,
}: {
  readonly content: string;
  readonly context: MarkdownContext;
}) {
  const document = useMemo(() => parseCached(content), [content]);
  return (
    <div className={styles['markdown']}>
      {document.children.map((block, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: AST nodes have no identity; content is immutable.
        <Block key={`${block.type}-${index}`} block={block} context={context} />
      ))}
    </div>
  );
}
