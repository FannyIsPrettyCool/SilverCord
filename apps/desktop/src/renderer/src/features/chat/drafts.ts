/** Per-account, per-channel composer drafts in local storage (docs/spec/messaging.md). */
const key = (userId: string, channelId: string) => `draft:${userId}:${channelId}`;

export function loadDraft(userId: string, channelId: string): string {
  try {
    return localStorage.getItem(key(userId, channelId)) ?? '';
  } catch {
    return '';
  }
}

export function saveDraft(userId: string, channelId: string, text: string) {
  try {
    if (text.trim()) localStorage.setItem(key(userId, channelId), text);
    else localStorage.removeItem(key(userId, channelId));
  } catch {
    // Storage can be unavailable; drafts are a convenience.
  }
}

export function clearDrafts(userId: string) {
  try {
    const prefix = `draft:${userId}:`;
    for (const name of Object.keys(localStorage))
      if (name.startsWith(prefix)) localStorage.removeItem(name);
  } catch {
    // Nothing to clear.
  }
}
