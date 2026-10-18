import {
  PROFILE_SECTIONS,
  type ProfileAudience,
  type ProfileSection,
  profileAudienceSchema,
} from '@silvercord/protocol';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { useOwnProfile, useSetProfilePrivacy } from '../../api/profiles.ts';
import styles from './settings.module.css';

function AudienceRow({
  section,
  value,
  disabled,
  onChange,
}: {
  readonly section: ProfileSection;
  readonly value: ProfileAudience;
  readonly disabled: boolean;
  readonly onChange: (value: ProfileAudience) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <div className={styles['audienceRow']}>
      <label htmlFor={id}>{t(`settings.section.${section}`)}</label>
      <select
        id={id}
        className={styles['select']}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(profileAudienceSchema.parse(event.target.value))}
      >
        {profileAudienceSchema.options.map((audience) => (
          <option key={audience} value={audience}>
            {t(`settings.audience.${audience}`)}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Who sees each profile section; the server enforces every choice (docs/spec/profiles.md). */
export function PrivacySettings() {
  const own = useOwnProfile();
  const save = useSetProfilePrivacy();
  const privacy = own.data?.privacy;
  if (!privacy) return null;
  return (
    <div className={styles['audiences']}>
      {PROFILE_SECTIONS.map((section) => (
        <AudienceRow
          key={section}
          section={section}
          value={save.variables?.[section] ?? privacy[section]}
          disabled={save.isPending}
          onChange={(audience) => save.mutate({ ...privacy, [section]: audience })}
        />
      ))}
    </div>
  );
}
