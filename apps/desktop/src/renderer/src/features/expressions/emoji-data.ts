/**
 * Unicode emoji for the picker (docs/spec/expressions.md): emojibase data in the UI language,
 * loaded on first use. Emoji newer than the bundled Noto Color Emoji font (Unicode 16) and the
 * skin-tone component group are left out.
 */
export interface PickerEmoji {
  readonly emoji: string;
  readonly label: string;
  readonly tags: readonly string[];
  /** Variants for skin tones 1–5, when the emoji has them. */
  readonly skins: readonly string[] | null;
}

export interface EmojiGroup {
  readonly key: string;
  readonly label: string;
  readonly emojis: readonly PickerEmoji[];
}

interface RawEmoji {
  readonly label: string;
  readonly emoji: string;
  readonly tags?: readonly string[];
  readonly group?: number;
  readonly order?: number;
  readonly version: number;
  readonly skins?: readonly {
    readonly emoji: string;
    readonly tone?: number | readonly number[];
  }[];
}

interface RawMessages {
  readonly groups: readonly {
    readonly key: string;
    readonly message: string;
    readonly order: number;
  }[];
}

export const FONT_EMOJI_VERSION = 16;
const COMPONENT_GROUP = 2;

export function buildGroups(raw: readonly RawEmoji[], messages: RawMessages): EmojiGroup[] {
  const byGroup = new Map<number, RawEmoji[]>();
  for (const entry of raw) {
    if (entry.group === undefined || entry.group === COMPONENT_GROUP) continue;
    if (entry.version > FONT_EMOJI_VERSION) continue;
    const list = byGroup.get(entry.group) ?? [];
    list.push(entry);
    byGroup.set(entry.group, list);
  }
  return messages.groups
    .filter((group) => byGroup.has(group.order))
    .sort((a, b) => a.order - b.order)
    .map((group) => ({
      key: group.key,
      label: group.message,
      emojis: (byGroup.get(group.order) ?? [])
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map((entry) => {
          // Single-tone variants only, in tone order; multi-person mixed tones are skipped.
          const skins = (entry.skins ?? [])
            .filter((skin) => typeof skin.tone === 'number')
            .sort((a, b) => Number(a.tone) - Number(b.tone))
            .map((skin) => skin.emoji);
          return {
            emoji: entry.emoji,
            label: entry.label,
            tags: entry.tags ?? [],
            skins: skins.length === 5 ? skins : null,
          };
        }),
    }));
}

const cache = new Map<string, Promise<EmojiGroup[]>>();

export function loadEmoji(locale: 'en' | 'fr'): Promise<EmojiGroup[]> {
  let entry = cache.get(locale);
  if (!entry) {
    entry = (
      locale === 'fr'
        ? Promise.all([
            import('emojibase-data/fr/data.json'),
            import('emojibase-data/fr/messages.json'),
          ])
        : Promise.all([
            import('emojibase-data/en/data.json'),
            import('emojibase-data/en/messages.json'),
          ])
    ).then(([data, messages]) =>
      buildGroups(data.default as RawEmoji[], messages.default as RawMessages),
    );
    entry.catch(() => cache.delete(locale));
    cache.set(locale, entry);
  }
  return entry;
}

const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Name, then tag matches; every word of the query must match. */
export function searchEmoji(groups: readonly EmojiGroup[], query: string, limit = 120) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const named: PickerEmoji[] = [];
  const tagged: PickerEmoji[] = [];
  for (const group of groups)
    for (const emoji of group.emojis) {
      const label = fold(emoji.label);
      const tags = emoji.tags.map(fold);
      if (words.every((word) => label.includes(word))) named.push(emoji);
      else if (
        words.every((word) => label.includes(word) || tags.some((tag) => tag.startsWith(word)))
      )
        tagged.push(emoji);
    }
  return [...named, ...tagged].slice(0, limit);
}
