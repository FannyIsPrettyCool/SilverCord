import type { Guild } from '@silvercord/protocol';
import { Button, Glass, TextField } from '@silvercord/ui';
import { useNavigate } from '@tanstack/react-router';
import { type ReactNode, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  captureAccountGeneration,
  isCurrentAccountGeneration,
} from '../../api/account-generation.ts';
import { useCreateGuild, useGuildActions } from '../../api/guilds.ts';
import dialogStyles from '../chat/dialog.module.css';
import { guildErrorKey } from './guild-error-key.ts';

export function GuildFormDialog({
  guild,
  trigger,
}: {
  readonly guild?: Guild;
  readonly trigger: (open: () => void) => ReactNode;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const epoch = useRef(0);
  const [name, setName] = useState(guild?.name ?? '');
  const create = useCreateGuild();
  const { rename } = useGuildActions(guild?.id ?? '');
  const mutation = guild ? rename : create;
  const navigate = useNavigate();
  const reset = () => {
    epoch.current += 1;
    setName(guild?.name ?? '');
    create.reset();
    rename.reset();
  };

  return (
    <>
      {trigger(() => {
        reset();
        dialog.current?.showModal();
      })}
      <dialog
        ref={dialog}
        className={dialogStyles['dialog']}
        aria-labelledby={titleId}
        onClose={reset}
      >
        <Glass level={3} className={dialogStyles['panel']}>
          <form
            className={dialogStyles['form']}
            onSubmit={async (event) => {
              event.preventDefault();
              const generation = captureAccountGeneration();
              const submittedIn = epoch.current;
              try {
                const result = guild
                  ? await rename.mutateAsync({ name: name.trim(), expectedVersion: guild.version })
                  : await create.mutateAsync({ name: name.trim() });
                if (
                  !isCurrentAccountGeneration(generation) ||
                  submittedIn !== epoch.current ||
                  !dialog.current?.open
                )
                  return;
                dialog.current?.close();
                await navigate({ to: '/app/guilds/$guildId', params: { guildId: result.id } });
              } catch {
                // Mutation state supplies the localized error without an unhandled rejection.
              }
            }}
          >
            <h2 id={titleId} className={dialogStyles['title']}>
              {t(guild ? 'guilds.renameServer' : 'guilds.createServer')}
            </h2>
            <TextField
              label={t('guilds.serverName')}
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={100}
              required
              disabled={mutation.isPending}
            />
            {mutation.error ? (
              <p className={dialogStyles['error']} role="alert">
                {t(guildErrorKey(mutation.error))}
              </p>
            ) : null}
            <div className={dialogStyles['actions']}>
              <Button variant="quiet" onClick={() => dialog.current?.close()}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={!name.trim()} loading={mutation.isPending}>
                {t(guild ? 'guilds.save' : 'chat.create')}
              </Button>
            </div>
          </form>
        </Glass>
      </dialog>
    </>
  );
}
