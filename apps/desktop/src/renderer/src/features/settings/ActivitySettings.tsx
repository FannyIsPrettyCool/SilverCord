import {
  ACTIVITY_SOURCES,
  type ActivitySources,
  type ActivityType,
  activityTypeSchema,
} from '@silvercord/protocol';
import { Button, Checkbox, TextField } from '@silvercord/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { UserGameEntry } from '../../../../shared/ipc-contract.ts';
import { useOwnActivity, useSetActivitySources, useSetManualActivity } from '../../api/activity.ts';
import { keys } from '../../api/query-client.ts';
import { desktop, unwrap } from '../../desktop.ts';
import { CLEAR_AFTER, expiryFor } from '../profiles/CustomStatusDialog.tsx';
import styles from './settings.module.css';

function TypedActivity() {
  const { t } = useTranslation();
  const own = useOwnActivity();
  const save = useSetManualActivity();
  const current = own.data?.manual ?? null;
  const [type, setType] = useState<ActivityType>(current?.activity.type ?? 'playing');
  const [name, setName] = useState(current?.activity.name ?? '');
  const [details, setDetails] = useState(current?.activity.details ?? '');
  const [clearAfter, setClearAfter] = useState<(typeof CLEAR_AFTER)[number]>('4h');
  const typeId = useId();
  const clearId = useId();
  return (
    <form
      className={styles['form']}
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate({
          activity: {
            type,
            name: name.trim(),
            ...(details.trim() ? { details: details.trim() } : {}),
            startedAt: new Date().toISOString(),
          },
          expiresAt: expiryFor(clearAfter),
        });
      }}
    >
      <div className={styles['audienceRow']}>
        <label htmlFor={typeId}>{t('activity.kind')}</label>
        <select
          id={typeId}
          className={styles['select']}
          value={type}
          onChange={(event) => setType(activityTypeSchema.parse(event.target.value))}
        >
          {activityTypeSchema.options.map((option) => (
            <option key={option} value={option}>
              {t(`activity.type.${option}`)}
            </option>
          ))}
        </select>
      </div>
      <TextField
        label={t('activity.name')}
        value={name}
        maxLength={128}
        onChange={(event) => setName(event.target.value)}
      />
      <TextField
        label={t('activity.details')}
        value={details}
        maxLength={128}
        onChange={(event) => setDetails(event.target.value)}
      />
      <div className={styles['audienceRow']}>
        <label htmlFor={clearId}>{t('customStatus.clearAfter')}</label>
        <select
          id={clearId}
          className={styles['select']}
          value={clearAfter}
          onChange={(event) => setClearAfter(event.target.value as (typeof CLEAR_AFTER)[number])}
        >
          {CLEAR_AFTER.map((choice) => (
            <option key={choice} value={choice}>
              {t(`customStatus.after.${choice}`)}
            </option>
          ))}
        </select>
      </div>
      <div className={styles['saveBar']}>
        <span />
        {current ? (
          <Button variant="quiet" onClick={() => save.mutate(null)}>
            {t('activity.clear')}
          </Button>
        ) : null}
        <Button type="submit" disabled={name.trim() === ''} loading={save.isPending}>
          {t('activity.set')}
        </Button>
      </div>
    </form>
  );
}

function Games() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const games = useQuery({
    queryKey: keys.activityGames,
    queryFn: () => unwrap(desktop().activity.games()),
  });
  const save = useMutation({
    mutationFn: (next: readonly UserGameEntry[]) => unwrap(desktop().activity.setGames(next)),
    onSuccess: (next) => queryClient.setQueryData(keys.activityGames, next),
  });
  const [process, setProcess] = useState('');
  const [name, setName] = useState('');
  const list = games.data ?? [];
  return (
    <div className={styles['form']}>
      <ul className={styles['rows']}>
        {list.map((game) => (
          <li key={game.process} className={styles['audienceRow']}>
            <span>
              <strong>{game.name}</strong> <span className={styles['handle']}>{game.process}</span>
            </span>
            <Button
              variant="quiet"
              onClick={() => save.mutate(list.filter((entry) => entry.process !== game.process))}
            >
              {t('activity.remove')}
            </Button>
          </li>
        ))}
      </ul>
      <form
        className={styles['awardForm']}
        onSubmit={(event) => {
          event.preventDefault();
          const entry = { process: process.trim().toLowerCase(), name: name.trim() };
          save.mutate([...list.filter((game) => game.process !== entry.process), entry]);
          setProcess('');
          setName('');
        }}
      >
        <TextField
          label={t('activity.process')}
          value={process}
          maxLength={128}
          placeholder="game.exe"
          onChange={(event) => setProcess(event.target.value)}
        />
        <TextField
          label={t('activity.gameName')}
          value={name}
          maxLength={128}
          onChange={(event) => setName(event.target.value)}
        />
        <Button
          type="submit"
          disabled={!process.trim() || !name.trim() || list.length >= 100}
          loading={save.isPending}
        >
          {t('activity.add')}
        </Button>
      </form>
    </div>
  );
}

function Apps() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const apps = useQuery({
    queryKey: keys.rpcApps,
    queryFn: () => unwrap(desktop().activity.rpcApps()),
  });
  const snapshot = useQuery({
    queryKey: ['activity-snapshot'],
    queryFn: () => unwrap(desktop().activity.snapshot()),
    refetchInterval: 5_000,
  });
  const forget = useMutation({
    mutationFn: (client: string) => unwrap(desktop().activity.forget({ client })),
    onSuccess: (next) => queryClient.setQueryData(keys.rpcApps, next),
  });
  const rows = [
    ...(apps.data?.allowed ?? []).map((client) => ({ client, allowed: true })),
    ...(apps.data?.denied ?? []).map((client) => ({ client, allowed: false })),
  ];
  return (
    <div className={styles['form']}>
      {snapshot.data?.rpcAddress ? (
        <p className={styles['handle']}>
          {t('activity.address')} <code>{snapshot.data.rpcAddress}</code>
        </p>
      ) : null}
      <ul className={styles['rows']}>
        {rows.map((row) => (
          <li key={row.client} className={styles['audienceRow']}>
            <span>
              <strong>{row.client}</strong>{' '}
              <span className={styles['handle']}>
                {row.allowed ? t('activity.allowed') : t('activity.denied')}
              </span>
            </span>
            <Button variant="quiet" onClick={() => forget.mutate(row.client)}>
              {t('activity.forget')}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Settings › Activity: every source is off until switched on here (docs/spec/activity.md). */
export function ActivitySettings() {
  const { t } = useTranslation();
  const own = useOwnActivity();
  const setSources = useSetActivitySources();
  const saved = own.data?.sources;
  if (!saved) return null;
  // Quick successive toggles build on the newest choice, not on the last saved one.
  const sources = setSources.isPending && setSources.variables ? setSources.variables : saved;
  const toggle = (source: keyof ActivitySources, on: boolean) =>
    setSources.mutate({ ...sources, [source]: on });
  return (
    <div className={styles['adminBadges']}>
      <fieldset className={styles['group']}>
        <legend>{t('activity.sources')}</legend>
        {ACTIVITY_SOURCES.map((source) => (
          <Checkbox
            key={source}
            checked={sources[source]}
            onCheckedChange={(on) => toggle(source, on)}
          >
            {t(`activity.source.${source}`)}
          </Checkbox>
        ))}
      </fieldset>
      {sources.manual ? (
        <fieldset className={styles['group']}>
          <legend>{t('activity.typed')}</legend>
          <TypedActivity />
        </fieldset>
      ) : null}
      {sources.game ? (
        <fieldset className={styles['group']}>
          <legend>{t('activity.games')}</legend>
          <Games />
        </fieldset>
      ) : null}
      {sources.rpc ? (
        <fieldset className={styles['group']}>
          <legend>{t('activity.apps')}</legend>
          <Apps />
        </fieldset>
      ) : null}
    </div>
  );
}
