import {
  Airplane,
  Basketball,
  Clock,
  Coffee,
  Flag,
  Hand,
  Heart,
  type Icon,
  Lightbulb,
  PawPrint,
  Smiley,
  Sparkle,
} from '@phosphor-icons/react';
import type { Emote, Sticker } from '@silvercord/protocol';
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUsableExpressions } from '../../api/expressions.ts';
import { useSession } from '../../session/session-store.ts';
import { ExpressionImage } from './EmoteImage.tsx';
import { type EmojiGroup, loadEmoji, type PickerEmoji, searchEmoji } from './emoji-data.ts';
import styles from './picker.module.css';

export type PickedExpression =
  | { readonly kind: 'unicode'; readonly emoji: string }
  | { readonly kind: 'emote'; readonly emote: Emote }
  | { readonly kind: 'sticker'; readonly sticker: Sticker };

const GROUP_ICONS: Readonly<Record<string, Icon>> = {
  'smileys-emotion': Smiley,
  'people-body': Hand,
  'animals-nature': PawPrint,
  'food-drink': Coffee,
  'travel-places': Airplane,
  activities: Basketball,
  objects: Lightbulb,
  symbols: Heart,
  flags: Flag,
};
const COLUMNS = 9;
const RECENTS_MAX = 32;

function storageKey(userId: string | null, name: string) {
  return `silvercord:${name}:${userId ?? 'anonymous'}`;
}
function readList(key: string): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown;
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

/** Arrow keys move between the buttons of one grid. */
function moveFocus(event: KeyboardEvent<HTMLElement>) {
  const moves: Record<string, number> = {
    ArrowRight: 1,
    ArrowLeft: -1,
    ArrowDown: COLUMNS,
    ArrowUp: -COLUMNS,
  };
  const step = moves[event.key];
  if (step === undefined) return;
  const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-cell]')];
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const next = buttons[Math.min(buttons.length - 1, Math.max(0, index + step))];
  if (next) {
    event.preventDefault();
    next.focus();
  }
}

function UnicodeCell({
  emoji,
  tone,
  onPick,
}: {
  readonly emoji: PickerEmoji;
  readonly tone: number;
  readonly onPick: (value: string) => void;
}) {
  const value = tone > 0 && emoji.skins ? (emoji.skins[tone - 1] ?? emoji.emoji) : emoji.emoji;
  return (
    <button
      type="button"
      data-cell
      className={styles['cell']}
      title={emoji.label}
      aria-label={emoji.label}
      onClick={() => onPick(value)}
    >
      <span className={styles['glyph']}>{value}</span>
    </button>
  );
}

/**
 * Unicode emoji (Noto Color Emoji), custom emotes from the user's guilds and, where allowed,
 * stickers (docs/spec/expressions.md).
 */
export function EmojiPicker({
  onPick,
  stickers = false,
  emotes = true,
}: {
  readonly onPick: (picked: PickedExpression) => void;
  /** Offer stickers (composer only). */
  readonly stickers?: boolean;
  /** Offer custom emotes (not in places that only take unicode). */
  readonly emotes?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const userId = useSession((s) => s.user?.id ?? null);
  const usable = useUsableExpressions();
  const [groups, setGroups] = useState<EmojiGroup[]>([]);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'emoji' | 'emotes' | 'stickers'>('emoji');
  const recentKey = storageKey(userId, 'recent-emoji');
  const toneKey = storageKey(userId, 'skin-tone');
  const [recents, setRecents] = useState<string[]>(() => readList(recentKey));
  const [tone, setTone] = useState(() => Number(readList(toneKey)[0] ?? 0));
  const search = useRef<HTMLInputElement>(null);
  const sections = useRef<Map<string, HTMLElement>>(new Map());

  useEffect(() => {
    let live = true;
    void loadEmoji(i18n.language === 'fr' ? 'fr' : 'en').then((loaded) => {
      if (live) setGroups(loaded);
    });
    search.current?.focus();
    return () => {
      live = false;
    };
  }, [i18n.language]);

  const remember = (value: string) => {
    const next = [value, ...recents.filter((item) => item !== value)].slice(0, RECENTS_MAX);
    setRecents(next);
    try {
      localStorage.setItem(recentKey, JSON.stringify(next));
    } catch {
      // Private mode or blocked storage: recents just are not kept.
    }
  };
  const pickUnicode = (emoji: string) => {
    remember(emoji);
    onPick({ kind: 'unicode', emoji });
  };
  const pickEmote = (emote: Emote) => {
    remember(`custom:${emote.id}`);
    onPick({ kind: 'emote', emote });
  };
  const chooseTone = (value: number) => {
    setTone(value);
    try {
      localStorage.setItem(toneKey, JSON.stringify([String(value)]));
    } catch {
      // As above.
    }
  };

  const allEmotes = useMemo(
    () => (usable.data?.guilds ?? []).flatMap((guild) => guild.emotes),
    [usable.data],
  );
  const emoteById = useMemo(
    () => new Map(allEmotes.map((emote) => [emote.id, emote])),
    [allEmotes],
  );
  const results = useMemo(
    () => (query.trim() ? searchEmoji(groups, query) : null),
    [groups, query],
  );
  const emoteResults = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle
      ? allEmotes.filter((emote) => emote.name.toLowerCase().includes(needle))
      : allEmotes;
  }, [allEmotes, query]);
  const byEmoji = useMemo(() => {
    const map = new Map<string, PickerEmoji>();
    for (const group of groups) for (const emoji of group.emojis) map.set(emoji.emoji, emoji);
    return map;
  }, [groups]);
  const hasGuildContent = (usable.data?.guilds ?? []).some(
    (guild) => guild.emotes.length > 0 || (stickers && guild.stickers.length > 0),
  );

  return (
    <div className={styles['picker']}>
      <div className={styles['top']}>
        <input
          ref={search}
          className={styles['search']}
          type="search"
          placeholder={t('expressions.search')}
          aria-label={t('expressions.search')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <label className={styles['tone']}>
          <span className={styles['srOnly']}>{t('expressions.skinTone')}</span>
          <select value={tone} onChange={(event) => chooseTone(Number(event.target.value))}>
            {(t('expressions.tones', { returnObjects: true }) as string[]).map((label, index) => (
              <option key={label} value={index}>
                {['✋', '✋🏻', '✋🏼', '✋🏽', '✋🏾', '✋🏿'][index]} {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {emotes && hasGuildContent ? (
        <div className={styles['tabs']} role="tablist">
          {(['emoji', 'emotes', ...(stickers ? ['stickers' as const] : [])] as const).map(
            (item) => (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={tab === item}
                className={styles['tab']}
                onClick={() => setTab(item)}
              >
                {item === 'emoji'
                  ? t('expressions.picker')
                  : item === 'emotes'
                    ? t('expressions.emotes')
                    : t('expressions.stickers')}
              </button>
            ),
          )}
        </div>
      ) : null}

      {tab === 'emoji' ? (
        <>
          {results === null ? (
            <nav className={styles['jump']} aria-label={t('expressions.picker')}>
              {groups.map((group) => {
                const Glyph = GROUP_ICONS[group.key] ?? Sparkle;
                return (
                  <button
                    key={group.key}
                    type="button"
                    className={styles['jumpButton']}
                    title={group.label}
                    aria-label={group.label}
                    onClick={() =>
                      sections.current.get(group.key)?.scrollIntoView({ block: 'start' })
                    }
                  >
                    <Glyph size={18} weight="duotone" />
                  </button>
                );
              })}
            </nav>
          ) : null}
          <fieldset
            aria-label={t('expressions.picker')}
            className={styles['scroll']}
            onKeyDown={moveFocus}
          >
            {results ? (
              results.length ? (
                <div className={styles['grid']}>
                  {results.map((emoji) => (
                    <UnicodeCell key={emoji.emoji} emoji={emoji} tone={tone} onPick={pickUnicode} />
                  ))}
                </div>
              ) : (
                <p className={styles['empty']}>{t('expressions.noResults')}</p>
              )
            ) : (
              <>
                {recents.length ? (
                  <section className={styles['section']}>
                    <h3 className={styles['heading']}>
                      <Clock size={14} weight="bold" aria-hidden="true" /> {t('expressions.recent')}
                    </h3>
                    <div className={styles['grid']}>
                      {recents.map((value) => {
                        const custom = /^custom:(\d+)$/.exec(value)?.[1];
                        if (custom) {
                          const emote = emotes ? emoteById.get(custom) : undefined;
                          return emote ? (
                            <button
                              key={value}
                              type="button"
                              data-cell
                              className={styles['cell']}
                              aria-label={`:${emote.name}:`}
                              onClick={() => pickEmote(emote)}
                            >
                              <ExpressionImage
                                image={emote.image}
                                label={`:${emote.name}:`}
                                size={28}
                              />
                            </button>
                          ) : null;
                        }
                        const known = byEmoji.get(value);
                        return (
                          <button
                            key={value}
                            type="button"
                            data-cell
                            className={styles['cell']}
                            aria-label={known?.label ?? value}
                            onClick={() => pickUnicode(value)}
                          >
                            <span className={styles['glyph']}>{value}</span>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                ) : null}
                {groups.map((group) => (
                  <section
                    key={group.key}
                    className={styles['section']}
                    ref={(element) => {
                      if (element) sections.current.set(group.key, element);
                    }}
                  >
                    <h3 className={styles['heading']}>{group.label}</h3>
                    <div className={styles['grid']}>
                      {group.emojis.map((emoji) => (
                        <UnicodeCell
                          key={emoji.emoji}
                          emoji={emoji}
                          tone={tone}
                          onPick={pickUnicode}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </>
            )}
          </fieldset>
        </>
      ) : null}

      {tab === 'emotes' ? (
        <fieldset
          aria-label={t('expressions.picker')}
          className={styles['scroll']}
          onKeyDown={moveFocus}
        >
          {(usable.data?.guilds ?? [])
            .filter((guild) => guild.emotes.length)
            .map((guild) => {
              const visible = guild.emotes.filter((emote) => emoteResults.includes(emote));
              return visible.length ? (
                <section key={guild.guildId} className={styles['section']}>
                  <h3 className={styles['heading']}>{guild.name}</h3>
                  <div className={styles['grid']}>
                    {visible.map((emote) => (
                      <button
                        key={emote.id}
                        type="button"
                        data-cell
                        className={styles['cell']}
                        title={`:${emote.name}:`}
                        aria-label={`:${emote.name}:`}
                        onClick={() => pickEmote(emote)}
                      >
                        <ExpressionImage image={emote.image} label={`:${emote.name}:`} size={28} />
                      </button>
                    ))}
                  </div>
                </section>
              ) : null;
            })}
        </fieldset>
      ) : null}

      {tab === 'stickers' ? (
        <div className={styles['scroll']}>
          {(usable.data?.guilds ?? [])
            .filter((guild) => guild.stickers.length)
            .map((guild) => (
              <section key={guild.guildId} className={styles['section']}>
                <h3 className={styles['heading']}>{guild.name}</h3>
                <div className={styles['stickerGrid']}>
                  {guild.stickers.map((sticker) => (
                    <button
                      key={sticker.id}
                      type="button"
                      className={styles['stickerCell']}
                      title={sticker.name}
                      aria-label={`${t('expressions.sendSticker')}: ${sticker.name}`}
                      onClick={() => onPick({ kind: 'sticker', sticker })}
                    >
                      <ExpressionImage image={sticker.image} label={sticker.name} size={88} />
                    </button>
                  ))}
                </div>
              </section>
            ))}
        </div>
      ) : null}
      <p className={styles['credit']}>{t('expressions.fontCredit')}</p>
    </div>
  );
}
