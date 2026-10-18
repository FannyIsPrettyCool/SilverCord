import {
  GameController,
  Headphones,
  Monitor,
  Plugs,
  Television,
  Trophy,
} from '@phosphor-icons/react';
import type { Activity } from '@silvercord/protocol';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './activity.module.css';

const ICONS = {
  playing: GameController,
  listening: Headphones,
  watching: Television,
  streaming: Monitor,
  competing: Trophy,
} as const;

/** `h:mm:ss` / `m:ss` elapsed since `startedAt`, ticking once a second while shown. */
export function elapsed(startedAt: string, now: number): string {
  const total = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${minutes}:${seconds}`;
}

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function ActivityRow({ activity, now }: { readonly activity: Activity; readonly now: number }) {
  const { t } = useTranslation();
  const Glyph = activity.source === 'rpc' && !activity.application ? Plugs : ICONS[activity.type];
  const progress =
    activity.startedAt && activity.endsAt
      ? Math.min(
          1,
          Math.max(
            0,
            (now - Date.parse(activity.startedAt)) /
              (Date.parse(activity.endsAt) - Date.parse(activity.startedAt)),
          ),
        )
      : null;
  return (
    <li className={styles['row']}>
      <span className={styles['glyph']} aria-hidden="true">
        <Glyph size={22} weight="duotone" />
      </span>
      <div className={styles['text']}>
        <span className={styles['verb']}>{t(`activity.verb.${activity.type}`)}</span>
        <strong className={styles['name']}>{activity.name}</strong>
        {activity.details ? <span className={styles['line']}>{activity.details}</span> : null}
        {activity.state ? <span className={styles['line']}>{activity.state}</span> : null}
        {activity.startedAt && !activity.endsAt ? (
          <time className={styles['time']} dateTime={activity.startedAt}>
            {elapsed(activity.startedAt, now)}
          </time>
        ) : null}
        {progress !== null ? (
          <span
            className={styles['progress']}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
          >
            <span style={{ transform: `scaleX(${progress})` }} />
          </span>
        ) : null}
        {activity.buttons.length ? (
          <span className={styles['buttons']}>
            {activity.buttons.map((button) => (
              <a
                key={button.url}
                className={styles['link']}
                href={button.url}
                target="_blank"
                rel="noreferrer noopener"
              >
                {button.label}
              </a>
            ))}
          </span>
        ) : null}
      </div>
    </li>
  );
}

/** Activities on a profile card, primary first. */
export function ActivityList({ activities }: { readonly activities: readonly Activity[] }) {
  const { t } = useTranslation();
  const now = useNow(activities.some((activity) => activity.startedAt));
  if (activities.length === 0) return null;
  return (
    <ul className={styles['list']} aria-label={t('settings.section.activity')}>
      {activities.map((activity) => (
        <ActivityRow key={`${activity.source}-${activity.name}`} activity={activity} now={now} />
      ))}
    </ul>
  );
}
