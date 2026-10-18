import type { VisibleMessage } from '@silvercord/protocol';
import { create } from 'zustand';
import { sendMessage } from '../../api/chat.ts';
import { DesktopError } from '../../desktop.ts';

export type Density = 'cozy' | 'compact' | 'bubble';

export interface PendingMessage {
  /** Idempotency key: one per logical send, reused on every retry. */
  readonly key: string;
  readonly channelId: string;
  readonly content: string;
  readonly replyToId: string | null;
  readonly attachmentIds: string[];
  readonly createdAt: number;
  readonly state: 'sending' | 'failed';
  readonly error: string | null;
}

interface ChatState {
  readonly pending: PendingMessage[];
  /** Per channel: the message being replied to, and the one being edited. */
  readonly replyTo: Record<string, VisibleMessage | undefined>;
  readonly editing: Record<string, string | undefined>;
  readonly density: Density;
  setReplyTo(channelId: string, message: VisibleMessage | undefined): void;
  setEditing(channelId: string, messageId: string | undefined): void;
  setDensity(density: Density): void;
}

const DENSITY_KEY = 'chat:density';

function storedDensity(): Density {
  try {
    const value = localStorage.getItem(DENSITY_KEY);
    return value === 'compact' || value === 'bubble' ? value : 'cozy';
  } catch {
    return 'cozy';
  }
}

export const useChatState = create<ChatState>()((set) => ({
  pending: [],
  replyTo: {},
  editing: {},
  density: storedDensity(),
  setReplyTo: (channelId, message) =>
    set((state) => ({ replyTo: { ...state.replyTo, [channelId]: message } })),
  setEditing: (channelId, messageId) =>
    set((state) => ({ editing: { ...state.editing, [channelId]: messageId } })),
  setDensity: (density) => {
    try {
      localStorage.setItem(DENSITY_KEY, density);
    } catch {
      // Preference only.
    }
    set({ density });
  },
}));

/** Errors where retrying cannot help: access or validation refusals. */
const FINAL = new Set(['FORBIDDEN', 'NOT_FOUND', 'VALIDATION_FAILED', 'CONFLICT']);

async function attempt(key: string) {
  const item = useChatState.getState().pending.find((candidate) => candidate.key === key);
  if (!item) return;
  const update = (change: Partial<PendingMessage>) =>
    useChatState.setState((state) => ({
      pending: state.pending.map((candidate) =>
        candidate.key === key ? { ...candidate, ...change } : candidate,
      ),
    }));
  update({ state: 'sending', error: null });
  try {
    await sendMessage(item.channelId, key, {
      content: item.content,
      ...(item.replyToId ? { replyToId: item.replyToId } : {}),
      ...(item.attachmentIds.length ? { attachmentIds: item.attachmentIds } : {}),
    });
    useChatState.setState((state) => ({
      pending: state.pending.filter((candidate) => candidate.key !== key),
    }));
  } catch (error) {
    const code = error instanceof DesktopError ? error.code : 'NETWORK';
    update({ state: 'failed', error: code });
    // Transient failures retry once by themselves; refusals wait for the user.
    if (!FINAL.has(code) && code !== 'RATE_LIMITED')
      setTimeout(() => void retryAutomatically(key), 3000);
  }
}

const autoRetried = new Set<string>();
async function retryAutomatically(key: string) {
  if (autoRetried.has(key)) return;
  autoRetried.add(key);
  await attempt(key);
}

export function queueMessage(input: Omit<PendingMessage, 'key' | 'createdAt' | 'state' | 'error'>) {
  const key = crypto.randomUUID();
  useChatState.setState((state) => ({
    pending: [
      ...state.pending,
      { ...input, key, createdAt: Date.now(), state: 'sending', error: null },
    ],
  }));
  void attempt(key);
}

export const retryMessage = (key: string) => void attempt(key);

export function discardMessage(key: string) {
  useChatState.setState((state) => ({
    pending: state.pending.filter((candidate) => candidate.key !== key),
  }));
}

export function resetChatState() {
  useChatState.setState({ pending: [], replyTo: {}, editing: {} });
  autoRetried.clear();
}
