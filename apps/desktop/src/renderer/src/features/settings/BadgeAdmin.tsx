import {
  BADGE_ICONS,
  BADGE_RARITIES,
  type BadgeDefinition,
  type BadgeIconName,
  type BadgeRarity,
  type BadgeVisual,
  badgeRaritySchema,
  type ProfileImage,
} from '@silvercord/protocol';
import { Button, TextField } from '@silvercord/ui';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBadgeAdmin, useBadgeDefinitions } from '../../api/badges.ts';
import { DesktopError } from '../../desktop.ts';
import { BADGE_ICON_COMPONENTS, BadgeMedallion } from '../profiles/BadgeShelf.tsx';
import { BadgeVisualEditor } from './BadgeVisualEditor.tsx';
import { ImagePicker } from './ImagePicker.tsx';
import styles from './settings.module.css';

function CreateBadge() {
  const { t } = useTranslation();
  const { create } = useBadgeAdmin();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visual, setVisual] = useState<BadgeVisual | null>(null);
  const [rarity, setRarity] = useState<BadgeRarity>('rare');
  const [icon, setIcon] = useState<BadgeIconName>('star');
  const [image, setImage] = useState<{ id: string; image: ProfileImage | null } | null>(null);
  const rarityId = useId();
  const iconGroup = useId();
  const preview: BadgeDefinition = {
    id: '0',
    key: null,
    name,
    description,
    rarity,
    icon: image?.image ? { kind: 'image', image: image.image } : { kind: 'icon', name: icon },
    retired: false,
    visual,
  };
  return (
    <form
      className={styles['form']}
      onSubmit={async (event) => {
        event.preventDefault();
        const created = await create
          .mutateAsync({
            name: name.trim(),
            description: description.trim(),
            rarity,
            visual,
            ...(image ? { iconUploadId: image.id } : { iconName: icon }),
          })
          .catch(() => null);
        if (!created) return;
        setName('');
        setDescription('');
        setImage(null);
      }}
    >
      <h3 className={styles['subheading']}>{t('badges.create')}</h3>
      <div className={styles['badgePreview']}>
        <BadgeMedallion badge={preview} size={56} />
      </div>
      <TextField
        label={t('badges.name')}
        value={name}
        maxLength={32}
        onChange={(event) => setName(event.target.value)}
      />
      <TextField
        label={t('badges.description')}
        value={description}
        maxLength={140}
        onChange={(event) => setDescription(event.target.value)}
      />
      <div className={styles['audienceRow']}>
        <label htmlFor={rarityId}>{t('badges.rarityLabel')}</label>
        <select
          id={rarityId}
          className={styles['select']}
          value={rarity}
          onChange={(event) => setRarity(badgeRaritySchema.parse(event.target.value))}
        >
          {BADGE_RARITIES.map((value) => (
            <option key={value} value={value}>
              {t(`badges.rarity.${value}`)}
            </option>
          ))}
        </select>
      </div>
      <fieldset className={styles['group']}>
        <legend>{t('badges.icon')}</legend>
        <div className={styles['iconGrid']}>
          {BADGE_ICONS.map((name) => {
            const Glyph = BADGE_ICON_COMPONENTS[name];
            return (
              <label key={name} className={styles['iconChoice']}>
                <input
                  type="radio"
                  name={iconGroup}
                  value={name}
                  aria-label={name}
                  className={styles['visuallyHidden']}
                  checked={!image && icon === name}
                  onChange={() => {
                    setImage(null);
                    setIcon(name);
                  }}
                />
                <Glyph size={20} weight="duotone" aria-hidden="true" />
              </label>
            );
          })}
        </div>
        <ImagePicker
          purpose="badge_icon"
          label={t('badges.image')}
          canRemove={image !== null}
          onReady={(upload) => setImage({ id: upload.id, image: upload.image })}
          onRemove={() => setImage(null)}
        />
      </fieldset>
      <BadgeVisualEditor badge={preview} value={visual} onChange={setVisual} />
      {create.error ? (
        <p className={styles['pickerError']} role="alert">
          {t('profileErrors.badgeFailed')}
        </p>
      ) : null}
      <div className={styles['saveBar']}>
        <span />
        <Button type="submit" disabled={name.trim() === ''} loading={create.isPending}>
          {t('badges.create')}
        </Button>
      </div>
    </form>
  );
}

function AwardRow({ badge }: { readonly badge: BadgeDefinition }) {
  const { t } = useTranslation();
  const { award, update } = useBadgeAdmin();
  const [username, setUsername] = useState('');
  const [reason, setReason] = useState('');
  const [visual, setVisual] = useState<BadgeVisual | null>(badge.visual ?? null);
  const notFound = award.error instanceof DesktopError && award.error.code === 'NOT_FOUND';
  return (
    <li className={styles['adminBadge']} data-retired={badge.retired || undefined}>
      <BadgeMedallion badge={badge} size={40} />
      <div className={styles['adminBadgeBody']}>
        <strong>{badge.name}</strong>
        <span className={styles['handle']}>
          {t(`badges.rarity.${badge.rarity}`)}
          {badge.retired ? ` · ${t('badges.retired')}` : ''}
        </span>
        <details>
          <summary>{t('badges.visual.edit')}</summary>
          <BadgeVisualEditor badge={badge} value={visual} onChange={setVisual} />
          <Button
            loading={update.isPending}
            onClick={() => update.mutate({ badgeId: badge.id, patch: { visual } })}
          >
            {t('guilds.save')}
          </Button>
          {update.error ? <p role="alert">{t('profileErrors.badgeFailed')}</p> : null}
        </details>
        {badge.retired ? null : (
          <form
            className={styles['awardForm']}
            onSubmit={async (event) => {
              event.preventDefault();
              const done = await award
                .mutateAsync({
                  badgeId: badge.id,
                  username: username.trim(),
                  reason: reason.trim() || null,
                })
                .catch(() => null);
              if (done) {
                setUsername('');
                setReason('');
              }
            }}
          >
            <TextField
              label={t('badges.username')}
              value={username}
              maxLength={32}
              error={notFound ? t('profileErrors.userNotFound') : undefined}
              onChange={(event) => setUsername(event.target.value)}
            />
            <TextField
              label={t('badges.reason')}
              value={reason}
              maxLength={140}
              onChange={(event) => setReason(event.target.value)}
            />
            <Button type="submit" disabled={username.trim() === ''} loading={award.isPending}>
              {award.isSuccess && username === '' ? t('badges.awarded') : t('badges.award')}
            </Button>
          </form>
        )}
      </div>
      <Button
        variant="quiet"
        loading={update.isPending}
        onClick={() => update.mutate({ badgeId: badge.id, patch: { retired: !badge.retired } })}
      >
        {badge.retired ? t('badges.restore') : t('badges.retire')}
      </Button>
    </li>
  );
}

/** Instance administrators: create manual badges and award them by username. */
export function BadgeAdmin() {
  const definitions = useBadgeDefinitions();
  const manual = (definitions.data ?? []).filter((badge) => badge.key === null);
  return (
    <div className={styles['adminBadges']}>
      <CreateBadge />
      <ul className={styles['adminList']}>
        {manual.map((badge) => (
          <AwardRow key={badge.id} badge={badge} />
        ))}
      </ul>
    </div>
  );
}
