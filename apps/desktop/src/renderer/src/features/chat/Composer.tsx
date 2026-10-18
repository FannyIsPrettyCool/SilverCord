import { ArrowClockwise, Paperclip, PaperPlaneRight, Smiley, X } from '@phosphor-icons/react';
import type { PublicUser } from '@silvercord/protocol';
import { Glass, IconButton } from '@silvercord/ui';
import { Mention } from '@tiptap/extension-mention';
import { Placeholder } from '@tiptap/extension-placeholder';
import { EditorContent, useEditor } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion';
import { motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { addUploads, cancelUpload, retryUpload, useUploads } from '../../api/media.ts';
import { clearTypingSignal, signalTyping } from '../../api/presence.ts';
import { useSession } from '../../session/session-store.ts';
import { EmojiPicker, type PickedExpression } from '../expressions/EmojiPicker.tsx';
import { EmoteNode } from '../expressions/emote-node.tsx';
import { Avatar, displayName } from '../presence/Avatar.tsx';
import { AnchoredPanel } from '../shell/AnchoredPanel.tsx';
import type { ChatChannel } from './chat-channel.ts';
import { queueMessage, useChatState } from './chat-state.ts';
import styles from './composer.module.css';
import { toChatMarkdown } from './composer-markdown.ts';
import { loadDraft, saveDraft } from './drafts.ts';

interface MentionPopup {
  readonly items: PublicUser[];
  readonly index: number;
  readonly select: ((user: PublicUser) => void) | null;
}

const useMentionPopup = create<MentionPopup>()(() => ({ items: [], index: 0, select: null }));
const MAX_SUGGESTIONS = 8;

function mentionSuggestion(members: () => PublicUser[]) {
  const open = (props: SuggestionProps<PublicUser>) =>
    useMentionPopup.setState((state) => ({
      items: props.items,
      index: Math.min(state.index, Math.max(0, props.items.length - 1)),
      select: (user) => props.command({ id: user.id, label: displayName(user) }),
    }));
  return {
    char: '@',
    items: ({ query }: { query: string }) => {
      const needle = query.toLowerCase();
      return members()
        .filter(
          (member) =>
            member.username.includes(needle) ||
            (member.displayName ?? '').toLowerCase().includes(needle),
        )
        .slice(0, MAX_SUGGESTIONS);
    },
    render: () => ({
      onStart: (props: SuggestionProps<PublicUser>) => {
        useMentionPopup.setState({ index: 0 });
        open(props);
      },
      onUpdate: open,
      onKeyDown: ({ event }: SuggestionKeyDownProps) => {
        const { items, index, select } = useMentionPopup.getState();
        if (items.length === 0) return false;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          const step = event.key === 'ArrowDown' ? 1 : -1;
          useMentionPopup.setState({ index: (index + step + items.length) % items.length });
          return true;
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          const user = items[index];
          if (user) select?.(user);
          return true;
        }
        return false;
      },
      onExit: () => useMentionPopup.setState({ items: [], index: 0, select: null }),
    }),
  };
}

function MentionList() {
  const { items, index, select } = useMentionPopup();
  if (items.length === 0) return null;
  return (
    <Glass level={3} className={styles['mentions']}>
      <div role="listbox" aria-label="@">
        {items.map((user, position) => (
          <div
            key={user.id}
            role="option"
            tabIndex={-1}
            aria-selected={position === index}
            className={styles['mentionOption']}
            onMouseDown={(event) => {
              event.preventDefault();
              select?.(user);
            }}
          >
            <Avatar user={user} size={24} />
            <span>{displayName(user)}</span>
            <span className={styles['mentionHandle']}>@{user.username}</span>
          </div>
        ))}
      </div>
    </Glass>
  );
}

function UploadChips({ channelId }: { readonly channelId: string }) {
  const { t } = useTranslation();
  const items = useUploads(
    useShallow((s) => s.items.filter((item) => item.channelId === channelId)),
  );
  if (items.length === 0) return null;
  return (
    <ul className={styles['uploads']} aria-label={t('chat.attachments')}>
      {items.map((item) => (
        <li key={item.localId} className={styles['upload']} data-status={item.status}>
          <span
            className={styles['progress']}
            style={{ '--progress': `${Math.round(item.progress * 100)}%` } as React.CSSProperties}
            aria-hidden="true"
          />
          <span className={styles['uploadName']}>{item.file.name}</span>
          <span className={styles['uploadState']} role="status">
            {t(`chat.upload.${item.status}`)}
          </span>
          {item.status === 'failed' ? (
            <IconButton label={t('chat.retry')} onClick={() => retryUpload(item.localId)}>
              <ArrowClockwise size={14} weight="bold" />
            </IconButton>
          ) : null}
          <IconButton label={t('chat.removeAttachment')} onClick={() => cancelUpload(item.localId)}>
            <X size={14} weight="bold" />
          </IconButton>
        </li>
      ))}
    </ul>
  );
}

/** Tiptap composer serializing to chat markdown (docs/spec/messaging.md). */
export function Composer({
  channel,
  placeholder,
}: {
  readonly channel: ChatChannel;
  readonly placeholder: string;
}) {
  const { t } = useTranslation();
  const userId = useSession((s) => s.user?.id ?? '');
  const replyTo = useChatState((s) => s.replyTo[channel.id]);
  const setReplyTo = useChatState((s) => s.setReplyTo);
  const uploads = useUploads(
    useShallow((s) => s.items.filter((item) => item.channelId === channel.id)),
  );
  const fileInput = useRef<HTMLInputElement>(null);
  const members = useRef<PublicUser[]>([]);
  members.current = channel.members.filter((member) => member.id !== userId);
  const sendRef = useRef<() => void>(() => {});
  const [empty, setEmpty] = useState(true);

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          heading: false,
          blockquote: false,
          bulletList: false,
          orderedList: false,
          listItem: false,
          codeBlock: false,
          horizontalRule: false,
          link: false,
        }),
        Placeholder.configure({ placeholder }),
        EmoteNode,
        Mention.configure({
          HTMLAttributes: { class: styles['mentionNode'] ?? '' },
          suggestion: mentionSuggestion(() => members.current),
        }),
      ],
      editorProps: {
        attributes: {
          class: styles['editor'] ?? '',
          'aria-label': placeholder,
          'aria-multiline': 'true',
          role: 'textbox',
        },
        handleKeyDown: (_view, event) => {
          if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return false;
          if (useMentionPopup.getState().items.length > 0) return false;
          event.preventDefault();
          sendRef.current();
          return true;
        },
        handlePaste: (_view, event) => {
          const files = [...(event.clipboardData?.files ?? [])];
          if (files.length === 0) return false;
          addUploads(channel.id, files);
          return true;
        },
        handleDrop: (_view, event) => {
          const files = [...(event.dataTransfer?.files ?? [])];
          if (files.length === 0) return false;
          event.preventDefault();
          addUploads(channel.id, files);
          return true;
        },
      },
      content: '',
      onCreate: ({ editor: created }) => {
        const draft = loadDraft(userId, channel.id);
        if (draft)
          created.commands.setContent({
            type: 'doc',
            content: draft.split('\n').map((line) => ({
              type: 'paragraph',
              ...(line ? { content: [{ type: 'text', text: line }] } : {}),
            })),
          });
        setEmpty(created.isEmpty);
      },
      onUpdate: ({ editor: updated }) => {
        const text = toChatMarkdown(updated.getJSON());
        saveDraft(userId, channel.id, text);
        setEmpty(updated.isEmpty);
        if (text.trim()) signalTyping(channel.id);
      },
    },
    [channel.id],
  );

  const ready = uploads.filter((item) => item.status === 'ready' && item.upload);
  const busy = uploads.some((item) => item.status === 'uploading' || item.status === 'processing');

  sendRef.current = () => {
    if (!editor || busy) return;
    const content = toChatMarkdown(editor.getJSON()).replace(/\s+$/, '');
    if (!content.trim() && ready.length === 0) return;
    queueMessage({
      channelId: channel.id,
      content,
      replyToId: replyTo?.id ?? null,
      attachmentIds: ready.flatMap((item) => (item.upload ? [item.upload.id] : [])),
    });
    editor.commands.clearContent(true);
    saveDraft(userId, channel.id, '');
    clearTypingSignal(channel.id);
    setReplyTo(channel.id, undefined);
    useUploads.getState().clearChannel(channel.id);
  };

  useEffect(() => {
    editor?.commands.focus();
  }, [editor]);

  const pick = (picked: PickedExpression) => {
    if (picked.kind === 'sticker') {
      // Stickers travel as their own message, like a reaction to the conversation.
      queueMessage({
        channelId: channel.id,
        content: `<sticker:${picked.sticker.id}>`,
        replyToId: replyTo?.id ?? null,
        attachmentIds: [],
      });
      setReplyTo(channel.id, undefined);
      return;
    }
    if (!editor) return;
    const chain = editor.chain().focus();
    if (picked.kind === 'unicode') chain.insertContent(picked.emoji).run();
    else
      chain
        .insertContent([
          {
            type: 'emote',
            attrs: {
              id: picked.emote.id,
              name: picked.emote.name,
              animated: picked.emote.animated,
            },
          },
          { type: 'text', text: ' ' },
        ])
        .run();
  };

  return (
    <div className={styles['wrap']}>
      <MentionList />
      <Glass level={2} className={styles['composer']}>
        {replyTo ? (
          <div className={styles['replyBar']}>
            <span>
              {t('chat.replyingTo', { name: replyTo.author ? displayName(replyTo.author) : '…' })}
            </span>
            <IconButton
              label={t('chat.cancelReply')}
              onClick={() => setReplyTo(channel.id, undefined)}
            >
              <X size={14} weight="bold" />
            </IconButton>
          </div>
        ) : null}
        <UploadChips channelId={channel.id} />
        <div className={styles['row']}>
          <IconButton label={t('chat.attach')} onClick={() => fileInput.current?.click()}>
            <Paperclip size={18} weight="duotone" />
          </IconButton>
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={(event) => {
              addUploads(channel.id, [...(event.target.files ?? [])]);
              event.target.value = '';
            }}
          />
          <EditorContent editor={editor} className={styles['field']} />
          <AnchoredPanel
            label={t('expressions.picker')}
            trigger={(props) => (
              <IconButton label={t('expressions.insert')} {...props}>
                <Smiley size={18} weight="duotone" />
              </IconButton>
            )}
          >
            {(close) => (
              <EmojiPicker
                stickers
                onPick={(picked) => {
                  pick(picked);
                  if (picked.kind === 'sticker') close();
                }}
              />
            )}
          </AnchoredPanel>
          <motion.div
            animate={{
              scale: empty && ready.length === 0 ? 0.9 : 1,
              opacity: empty && ready.length === 0 ? 0.5 : 1,
            }}
            transition={{ type: 'spring', stiffness: 500, damping: 26 }}
          >
            <IconButton
              label={t('chat.send')}
              disabled={busy || (empty && ready.length === 0)}
              onClick={() => sendRef.current()}
            >
              <PaperPlaneRight size={18} weight="fill" />
            </IconButton>
          </motion.div>
        </div>
      </Glass>
    </div>
  );
}
