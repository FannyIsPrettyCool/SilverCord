import { has, Permission, parsePermissions } from '@silvercord/permissions';
import {
  BIO_MAX,
  type GuildMemberProfile,
  type GuildMemberProfilePatch,
  PRONOUNS_MAX,
  type ProfileImage,
} from '@silvercord/protocol';
import { Button, TextField } from '@silvercord/ui';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useGuilds } from '../../api/guilds.ts';
import { useGuildProfile, useOwnProfile, usePatchGuildProfile } from '../../api/profiles.ts';
import { ProfileCard } from '../profiles/ProfileCard.tsx';
import { ImagePicker } from './ImagePicker.tsx';
import styles from './settings.module.css';

interface Draft {
  readonly nickname: string;
  readonly pronouns: string;
  readonly bio: string;
  readonly avatar: { readonly id: string | null; readonly image: ProfileImage | null } | undefined;
  readonly banner: { readonly id: string | null; readonly image: ProfileImage | null } | undefined;
}

const draftOf = (profile: GuildMemberProfile): Draft => ({
  nickname: profile.nickname ?? '',
  pronouns: profile.pronouns ?? '',
  bio: profile.bio ?? '',
  avatar: undefined,
  banner: undefined,
});

function patchOf(profile: GuildMemberProfile, draft: Draft): GuildMemberProfilePatch | null {
  const text = (value: string) => (value.trim() === '' ? null : value.trim());
  const patch: Record<string, unknown> = {};
  if (text(draft.nickname) !== profile.nickname) patch['nickname'] = text(draft.nickname);
  if (text(draft.pronouns) !== profile.pronouns) patch['pronouns'] = text(draft.pronouns);
  if (text(draft.bio) !== profile.bio) patch['bio'] = text(draft.bio);
  if (draft.avatar) patch['avatarUploadId'] = draft.avatar.id;
  if (draft.banner) patch['bannerUploadId'] = draft.banner.id;
  return Object.keys(patch).length === 0 ? null : (patch as GuildMemberProfilePatch);
}

function GuildProfileForm({
  guildId,
  canNickname,
}: {
  readonly guildId: string;
  readonly canNickname: boolean;
}) {
  const { t } = useTranslation();
  const own = useOwnProfile();
  const profile = useGuildProfile(guildId);
  const save = usePatchGuildProfile(guildId);
  const [draft, setDraft] = useState<Draft | null>(null);
  const bioId = useId();
  useEffect(() => {
    if (profile.data && !draft) setDraft(draftOf(profile.data));
  }, [profile.data, draft]);
  if (!profile.data || !draft || !own.data) return null;
  const global = own.data;
  const current = profile.data;
  const set = (change: Partial<Draft>) => setDraft({ ...draft, ...change });
  const patch = patchOf(current, draft);
  const avatar = draft.avatar ? draft.avatar.image : current.avatar;
  const banner = draft.banner ? draft.banner.image : current.banner;
  return (
    <div className={styles['editor']}>
      <form
        className={styles['form']}
        onSubmit={async (event) => {
          event.preventDefault();
          if (!patch) return;
          const saved = await save.mutateAsync(patch).catch(() => null);
          if (saved) setDraft(draftOf(saved));
        }}
      >
        <TextField
          label={t('settings.nickname')}
          value={draft.nickname}
          maxLength={32}
          disabled={!canNickname}
          placeholder={global.displayName ?? global.username}
          onChange={(event) => set({ nickname: event.target.value })}
        />
        <TextField
          label={t('settings.pronouns')}
          value={draft.pronouns}
          maxLength={PRONOUNS_MAX}
          placeholder={global.pronouns ?? undefined}
          onChange={(event) => set({ pronouns: event.target.value })}
        />
        <div className={styles['field']}>
          <div className={styles['fieldHead']}>
            <label htmlFor={bioId}>{t('settings.bio')}</label>
            <span className={styles['counter']}>
              {t('settings.count', { count: [...draft.bio].length, max: BIO_MAX })}
            </span>
          </div>
          <textarea
            id={bioId}
            className={styles['textarea']}
            rows={4}
            value={draft.bio}
            placeholder={global.bio ?? undefined}
            onChange={(event) => set({ bio: event.target.value })}
          />
        </div>
        <fieldset className={styles['group']}>
          <legend>{t('settings.avatar')}</legend>
          <ImagePicker
            purpose="guild_avatar"
            guildId={guildId}
            label={t('settings.avatar')}
            canRemove={avatar !== null}
            onReady={(upload) => set({ avatar: { id: upload.id, image: upload.image } })}
            onRemove={() => set({ avatar: { id: null, image: null } })}
          />
        </fieldset>
        <fieldset className={styles['group']}>
          <legend>{t('settings.banner')}</legend>
          <ImagePicker
            purpose="guild_banner"
            guildId={guildId}
            label={t('settings.banner')}
            canRemove={banner !== null}
            onReady={(upload) => set({ banner: { id: upload.id, image: upload.image } })}
            onRemove={() => set({ banner: { id: null, image: null } })}
          />
        </fieldset>
        <div className={styles['saveBar']} data-dirty={patch ? true : undefined}>
          <span role="status" aria-live="polite">
            {patch ? t('settings.unsaved') : save.isSuccess ? t('settings.saved') : null}
          </span>
          <Button variant="quiet" disabled={!patch} onClick={() => setDraft(draftOf(current))}>
            {t('settings.reset')}
          </Button>
          <Button type="submit" disabled={!patch} loading={save.isPending}>
            {t('settings.save')}
          </Button>
        </div>
      </form>
      <aside className={styles['preview']} aria-label={t('settings.preview')}>
        <ProfileCard
          card={{
            user: {
              id: global.userId,
              username: global.username,
              displayName: global.displayName,
            },
            nickname: draft.nickname.trim() || null,
            avatar: avatar ?? global.avatar,
            banner: banner ?? global.banner,
            accentColor: global.accentColor,
            bannerColor: global.bannerColor,
            themeColors: global.themeColors,
            pronouns: draft.pronouns.trim() || global.pronouns,
            bio: draft.bio.trim() || global.bio,
            memberSince: global.memberSince,
          }}
        />
      </aside>
    </div>
  );
}

/** Per-server nickname, images and bio; empty fields inherit the global profile. */
export function ServerProfileSettings() {
  const { t } = useTranslation();
  const guilds = useGuilds();
  const [selected, setSelected] = useState<string | null>(null);
  const selectId = useId();
  const items = guilds.data?.items ?? [];
  const guildId = selected ?? items[0]?.id ?? null;
  const guild = items.find((item) => item.id === guildId);
  if (items.length === 0) return <p className={styles['empty']}>{t('settings.noServers')}</p>;
  return (
    <div className={styles['servers']}>
      <div className={styles['audienceRow']}>
        <label htmlFor={selectId}>{t('settings.server')}</label>
        <select
          id={selectId}
          className={styles['select']}
          value={guildId ?? ''}
          onChange={(event) => setSelected(event.target.value)}
        >
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </div>
      {guild ? (
        <GuildProfileForm
          key={guild.id}
          guildId={guild.id}
          canNickname={has(parsePermissions(guild.permissions), Permission.CHANGE_NICKNAME)}
        />
      ) : null}
    </div>
  );
}
