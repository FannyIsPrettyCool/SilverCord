import { ArrowBendUpLeft, PencilSimple, Smiley, Trash } from '@phosphor-icons/react';
import type { Message, PublicUser, VisibleMessage } from '@silvercord/protocol';
import { Glass, IconButton } from '@silvercord/ui';
import { motion } from 'motion/react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMessageActions } from '../../api/chat.ts';
import { Avatar, displayName } from '../presence/Avatar.tsx';
import { Popover } from '../shell/Popover.tsx';
import { Attachments } from './Attachments.tsx';
import { type Density, useChatState } from './chat-state.ts';
import { MarkdownView } from './MarkdownView.tsx';
import styles from './message.module.css';

/** Quick reactions until the full emoji picker (phase 5). */
const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🎉'] as const;

export interface MessageContext {
  readonly channelId: string;
  readonly selfId: string;
  readonly users: ReadonlyMap<string, PublicUser>;
  readonly density: Density;
  readonly onJump: (messageId: string) => void;
}

/** Formatter construction is costly; rows mount constantly while scrolling. */
const formatters = new Map<string, { short: Intl.DateTimeFormat; full: Intl.DateTimeFormat }>();

function useTime(iso: string) {
  const { i18n } = useTranslation();
  let formatter = formatters.get(i18n.language);
  if (!formatter) {
    formatter = {
      short: new Intl.DateTimeFormat(i18n.language, { timeStyle: 'short' }),
      full: new Intl.DateTimeFormat(i18n.language, { dateStyle: 'full', timeStyle: 'short' }),
    };
    formatters.set(i18n.language, formatter);
  }
  const date = new Date(iso);
  return { short: formatter.short.format(date), full: formatter.full.format(date) };
}

function Editor({
  message,
  context,
}: {
  readonly message: VisibleMessage;
  readonly context: MessageContext;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(message.content);
  const actions = useMessageActions(context.channelId);
  const setEditing = useChatState((s) => s.setEditing);
  const stop = () => setEditing(context.channelId, undefined);
  const save = async () => {
    if (value === message.content) return stop();
    await actions.edit.mutateAsync({
      messageId: message.id,
      content: value,
      expectedVersion: message.version,
    });
    stop();
  };
  return (
    <div className={styles['editor']}>
      <textarea
        className={styles['editInput']}
        value={value}
        aria-label={t('chat.editMessage')}
        // biome-ignore lint/a11y/noAutofocus: editing starts from an explicit user action.
        autoFocus
        rows={Math.min(8, value.split('\n').length + 1)}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') stop();
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void save();
          }
        }}
      />
      {actions.edit.isError ? (
        <p className={styles['editError']} role="alert">
          {t('chat.editConflict')}
        </p>
      ) : null}
    </div>
  );
}

function Toolbar({
  message,
  context,
}: {
  readonly message: VisibleMessage;
  readonly context: MessageContext;
}) {
  const { t } = useTranslation();
  const actions = useMessageActions(context.channelId);
  const setReplyTo = useChatState((s) => s.setReplyTo);
  const setEditing = useChatState((s) => s.setEditing);
  const own = message.author?.id === context.selfId;
  return (
    <Glass level={1} pill className={styles['toolbar']}>
      <Popover
        placement="bottom-end"
        trigger={({ toggle, ...aria }) => (
          <IconButton label={t('chat.react')} onClick={toggle} {...aria}>
            <Smiley size={16} weight="duotone" />
          </IconButton>
        )}
      >
        {(close) => (
          <div className={styles['quickReactions']}>
            {QUICK_REACTIONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className={styles['quickReaction']}
                aria-label={emoji}
                onClick={() => {
                  actions.react.mutate({ messageId: message.id, emoji, add: true });
                  close();
                }}
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
      </Popover>
      <IconButton label={t('chat.reply')} onClick={() => setReplyTo(context.channelId, message)}>
        <ArrowBendUpLeft size={16} weight="duotone" />
      </IconButton>
      {own ? (
        <>
          <IconButton
            label={t('chat.edit')}
            onClick={() => setEditing(context.channelId, message.id)}
          >
            <PencilSimple size={16} weight="duotone" />
          </IconButton>
          <IconButton label={t('chat.delete')} onClick={() => actions.remove.mutate(message.id)}>
            <Trash size={16} weight="duotone" />
          </IconButton>
        </>
      ) : null}
    </Glass>
  );
}

function Reactions({
  message,
  context,
}: {
  readonly message: VisibleMessage;
  readonly context: MessageContext;
}) {
  // Most rows have no reactions: skip the mutation hooks entirely for them.
  if (message.reactions.length === 0) return null;
  return <ReactionChips message={message} context={context} />;
}

function ReactionChips({
  message,
  context,
}: {
  readonly message: VisibleMessage;
  readonly context: MessageContext;
}) {
  const actions = useMessageActions(context.channelId);
  return (
    <div className={styles['reactions']}>
      {message.reactions.map((reaction) => (
        <motion.button
          key={reaction.emoji}
          type="button"
          layout
          className={styles['reaction']}
          aria-pressed={reaction.me}
          initial={{ scale: 0.6 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 520, damping: 18 }}
          onClick={() =>
            actions.react.mutate({
              messageId: message.id,
              emoji: reaction.emoji,
              add: !reaction.me,
            })
          }
        >
          <span>{reaction.emoji}</span>
          <span className={styles['reactionCount']}>{reaction.count}</span>
        </motion.button>
      ))}
    </div>
  );
}

function ReplyReference({
  message,
  context,
}: {
  readonly message: VisibleMessage;
  readonly context: MessageContext;
}) {
  const { t } = useTranslation();
  const reply = message.reply;
  if (!reply) return null;
  if (reply.state !== 'visible')
    return (
      <div className={styles['replyRef']} data-muted>
        <ArrowBendUpLeft size={12} aria-hidden="true" />
        {reply.state === 'hidden' ? t('chat.blockedMessage') : t('chat.deletedMessage')}
      </div>
    );
  return (
    <button type="button" className={styles['replyRef']} onClick={() => context.onJump(reply.id)}>
      <ArrowBendUpLeft size={12} aria-hidden="true" />
      <span className={styles['replyAuthor']}>
        {reply.author ? displayName(reply.author) : '…'}
      </span>
      <span className={styles['replyExcerpt']}>{reply.excerpt}</span>
    </button>
  );
}

function Body({
  message,
  context,
}: {
  readonly message: VisibleMessage;
  readonly context: MessageContext;
}) {
  const { t } = useTranslation();
  const editing = useChatState((s) => s.editing[context.channelId] === message.id);
  return (
    <>
      <ReplyReference message={message} context={context} />
      {editing ? (
        <Editor message={message} context={context} />
      ) : message.content ? (
        <div className={styles['content']}>
          <MarkdownView
            content={message.content}
            context={{ users: context.users, selfId: context.selfId }}
          />
          {message.editedAt ? <span className={styles['edited']}>{t('chat.edited')}</span> : null}
        </div>
      ) : null}
      <Attachments items={message.attachments} />
      <Reactions message={message} context={context} />
    </>
  );
}

/** One message in cozy, compact or bubble density; `grouped` hides the repeated header. */
export const MessageItem = memo(function MessageItem({
  message,
  grouped,
  context,
}: {
  readonly message: Message;
  readonly grouped: boolean;
  readonly context: MessageContext;
}) {
  const { t } = useTranslation();
  const time = useTime(message.hidden ? new Date().toISOString() : message.createdAt);
  // The action toolbar mounts only while the row is hovered or focused: rows mount constantly
  // during scrolling and the toolbar (glass, popover, mutations) is the heaviest part.
  const [active, setActive] = useState(false);
  const activity = {
    onPointerEnter: () => setActive(true),
    onPointerLeave: () => setActive(false),
    onFocus: () => setActive(true),
    onBlur: (event: React.FocusEvent<HTMLElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setActive(false);
    },
  };
  if (message.hidden) {
    return (
      <div className={styles['hidden']} data-message-id={message.id}>
        {t('chat.blockedMessage')}
      </div>
    );
  }
  const author = message.author;
  const name = author ? displayName(author) : t('chat.deletedUser');
  const own = author?.id === context.selfId;
  const mentioned = message.mentions.includes(context.selfId);

  if (context.density === 'bubble') {
    return (
      <article
        className={styles['bubbleRow']}
        data-own={own || undefined}
        data-grouped={grouped || undefined}
        data-message-id={message.id}
        aria-label={`${name}, ${time.full}`}
        {...activity}
      >
        <div className={styles['bubble']} data-own={own || undefined}>
          <Body message={message} context={context} />
          <time className={styles['bubbleTime']} dateTime={message.createdAt} title={time.full}>
            {time.short}
          </time>
        </div>
        {active ? <Toolbar message={message} context={context} /> : null}
      </article>
    );
  }

  return (
    <article
      className={styles['message']}
      data-density={context.density}
      data-grouped={grouped || undefined}
      data-mentioned={mentioned || undefined}
      data-message-id={message.id}
      aria-label={`${name}, ${time.full}`}
      {...activity}
    >
      {context.density === 'compact' ? (
        <time className={styles['compactTime']} dateTime={message.createdAt} title={time.full}>
          {time.short}
        </time>
      ) : grouped ? (
        <time className={styles['gutterTime']} dateTime={message.createdAt} title={time.full}>
          {time.short}
        </time>
      ) : author ? (
        <Avatar user={author} size={40} />
      ) : (
        <span className={styles['ghostAvatar']} aria-hidden="true" />
      )}
      <div className={styles['main']}>
        {!grouped || context.density === 'compact' ? (
          <header className={styles['header']}>
            <span className={styles['author']}>{name}</span>
            {context.density === 'cozy' ? (
              <time className={styles['time']} dateTime={message.createdAt} title={time.full}>
                {time.short}
              </time>
            ) : null}
          </header>
        ) : null}
        <Body message={message} context={context} />
      </div>
      {active ? <Toolbar message={message} context={context} /> : null}
    </article>
  );
});
