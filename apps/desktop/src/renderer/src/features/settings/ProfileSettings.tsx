import {
  BIO_MAX,
  type OwnProfile,
  PRONOUNS_MAX,
  type ProfileImage,
  type ProfilePatch,
} from '@silvercord/protocol';
import { Button, TextField } from '@silvercord/ui';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useOwnProfile, usePatchProfile } from '../../api/profiles.ts';
import { DesktopError } from '../../desktop.ts';
import { hex, ProfileCard } from '../profiles/ProfileCard.tsx';
import { ImagePicker } from './ImagePicker.tsx';
import styles from './settings.module.css';

interface Draft {
  readonly displayName: string;
  readonly pronouns: string;
  readonly bio: string;
  readonly accentColor: number | null;
  readonly bannerColor: number | null;
  readonly themeColors: readonly [number, number] | null;
  /** Upload id + preview for a newly picked image; null removes; undefined keeps. */
  readonly avatar: { readonly id: string | null; readonly image: ProfileImage | null } | undefined;
  readonly banner: { readonly id: string | null; readonly image: ProfileImage | null } | undefined;
}

const fromProfile = (profile: OwnProfile): Draft => ({
  displayName: profile.displayName ?? '',
  pronouns: profile.pronouns ?? '',
  bio: profile.bio ?? '',
  accentColor: profile.accentColor,
  bannerColor: profile.bannerColor,
  themeColors: profile.themeColors,
  avatar: undefined,
  banner: undefined,
});

/** Only changed fields go to the server; an empty text field clears its value. */
export function patchOf(profile: OwnProfile, draft: Draft): ProfilePatch | null {
  const patch: Record<string, unknown> = {};
  const text = (value: string) => (value.trim() === '' ? null : value.trim());
  if (text(draft.displayName) !== profile.displayName)
    patch['displayName'] = text(draft.displayName);
  if (text(draft.pronouns) !== profile.pronouns) patch['pronouns'] = text(draft.pronouns);
  if (text(draft.bio) !== profile.bio) patch['bio'] = text(draft.bio);
  if (draft.accentColor !== profile.accentColor) patch['accentColor'] = draft.accentColor;
  if (draft.bannerColor !== profile.bannerColor) patch['bannerColor'] = draft.bannerColor;
  if (JSON.stringify(draft.themeColors) !== JSON.stringify(profile.themeColors))
    patch['themeColors'] = draft.themeColors;
  if (draft.avatar) patch['avatarUploadId'] = draft.avatar.id;
  if (draft.banner) patch['bannerUploadId'] = draft.banner.id;
  return Object.keys(patch).length === 0
    ? null
    : ({ version: profile.version, ...patch } as ProfilePatch);
}

function ColourField({
  label,
  value,
  fallback,
  onChange,
}: {
  readonly label: string;
  readonly value: number | null;
  readonly fallback: number;
  readonly onChange: (value: number | null) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <div className={styles['colour']}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="color"
        value={hex(value ?? fallback)}
        onChange={(event) => onChange(Number.parseInt(event.target.value.slice(1), 16))}
      />
      <label className={styles['auto']}>
        <input
          type="checkbox"
          checked={value === null}
          onChange={(event) => onChange(event.target.checked ? null : fallback)}
        />
        {t('settings.auto')}
      </label>
    </div>
  );
}

/** Own profile editor with a live card preview beside the form (docs/spec/profile-screens.md). */
export function ProfileSettings() {
  const { t } = useTranslation();
  const own = useOwnProfile();
  const save = usePatchProfile();
  const [draft, setDraft] = useState<Draft | null>(null);
  const bioId = useId();
  const pronounsList = useId();
  const profile = own.data;
  useEffect(() => {
    if (profile && !draft) setDraft(fromProfile(profile));
  }, [profile, draft]);
  if (!profile || !draft) return null;

  const set = (change: Partial<Draft>) => setDraft({ ...draft, ...change });
  const patch = patchOf(profile, draft);
  const suggestions = t('settings.pronounSuggestions', { returnObjects: true }) as string[];
  const avatar = draft.avatar ? draft.avatar.image : profile.avatar;
  const banner = draft.banner ? draft.banner.image : profile.banner;
  const bioLength = [...draft.bio].length;
  const conflict = save.error instanceof DesktopError && save.error.code === 'CONFLICT';

  return (
    <div className={styles['editor']}>
      <form
        className={styles['form']}
        onSubmit={async (event) => {
          event.preventDefault();
          if (!patch) return;
          const saved = await save.mutateAsync(patch).catch(() => null);
          if (saved) setDraft(fromProfile(saved));
        }}
      >
        <TextField
          label={t('settings.displayName')}
          value={draft.displayName}
          maxLength={32}
          placeholder={profile.username}
          onChange={(event) => set({ displayName: event.target.value })}
        />
        <TextField
          label={t('settings.pronouns')}
          value={draft.pronouns}
          maxLength={PRONOUNS_MAX}
          list={pronounsList}
          onChange={(event) => set({ pronouns: event.target.value })}
        />
        <datalist id={pronounsList}>
          {suggestions.map((value) => (
            <option key={value} value={value} />
          ))}
        </datalist>
        <div className={styles['field']}>
          <div className={styles['fieldHead']}>
            <label htmlFor={bioId}>{t('settings.bio')}</label>
            <span
              className={styles['counter']}
              data-over={bioLength > BIO_MAX || undefined}
              aria-live="polite"
            >
              {t('settings.count', { count: bioLength, max: BIO_MAX })}
            </span>
          </div>
          <textarea
            id={bioId}
            className={styles['textarea']}
            rows={5}
            value={draft.bio}
            onChange={(event) => set({ bio: event.target.value })}
          />
        </div>
        <fieldset className={styles['group']}>
          <legend>{t('settings.avatar')}</legend>
          <ImagePicker
            purpose="avatar"
            label={t('settings.avatar')}
            canRemove={avatar !== null}
            onReady={(upload) => set({ avatar: { id: upload.id, image: upload.image } })}
            onRemove={() => set({ avatar: { id: null, image: null } })}
          />
        </fieldset>
        <fieldset className={styles['group']}>
          <legend>{t('settings.banner')}</legend>
          <ImagePicker
            purpose="banner"
            label={t('settings.banner')}
            canRemove={banner !== null}
            onReady={(upload) => set({ banner: { id: upload.id, image: upload.image } })}
            onRemove={() => set({ banner: { id: null, image: null } })}
          />
          <ColourField
            label={t('settings.bannerColor')}
            value={draft.bannerColor}
            fallback={avatar?.dominantColor ?? 0x6c8cff}
            onChange={(bannerColor) => set({ bannerColor })}
          />
        </fieldset>
        <fieldset className={styles['group']}>
          <legend>{t('settings.theme')}</legend>
          <ColourField
            label={t('settings.accent')}
            value={draft.accentColor}
            fallback={0x6c8cff}
            onChange={(accentColor) => set({ accentColor })}
          />
          <ColourField
            label={t('settings.themePrimary')}
            value={draft.themeColors?.[0] ?? null}
            fallback={0x4fd8ff}
            onChange={(value) =>
              set({
                themeColors: value === null ? null : [value, draft.themeColors?.[1] ?? 0xff6bd6],
              })
            }
          />
          <ColourField
            label={t('settings.themeSecondary')}
            value={draft.themeColors?.[1] ?? null}
            fallback={0xff6bd6}
            onChange={(value) =>
              set({
                themeColors: value === null ? null : [draft.themeColors?.[0] ?? 0x4fd8ff, value],
              })
            }
          />
        </fieldset>
        <div className={styles['saveBar']} data-dirty={patch ? true : undefined}>
          <span role="status" aria-live="polite">
            {conflict
              ? t('profileErrors.conflict')
              : patch
                ? t('settings.unsaved')
                : save.isSuccess
                  ? t('settings.saved')
                  : null}
          </span>
          <Button
            variant="quiet"
            disabled={!patch}
            onClick={() => {
              save.reset();
              setDraft(fromProfile(profile));
            }}
          >
            {t('settings.reset')}
          </Button>
          <Button type="submit" disabled={!patch || bioLength > BIO_MAX} loading={save.isPending}>
            {t('settings.save')}
          </Button>
        </div>
      </form>
      <aside className={styles['preview']} aria-label={t('settings.preview')}>
        <ProfileCard
          card={{
            user: {
              id: profile.userId,
              username: profile.username,
              displayName: draft.displayName.trim() || null,
            },
            avatar,
            banner,
            accentColor: draft.accentColor,
            bannerColor: draft.bannerColor,
            themeColors: draft.themeColors,
            pronouns: draft.pronouns.trim() || null,
            bio: draft.bio.trim() || null,
            customStatus: profile.customStatus,
            memberSince: profile.memberSince,
          }}
        />
      </aside>
    </div>
  );
}
