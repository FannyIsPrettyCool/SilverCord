import { recoveryCodeSchema, totpCodeSchema } from '@silvercord/protocol';
import { Button, TextField } from '@silvercord/ui';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSession } from '../../session/session-store.ts';
import { AuthLayout, authStyles as styles } from './AuthLayout.tsx';
import { useSubmit } from './use-submit.ts';

export function CodeScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const secondFactor = useSession((s) => s.secondFactor);
  const [mode, setMode] = useState<'app' | 'recovery'>('app');
  const [value, setValue] = useState('');

  const { pending, error, setError, submit } = useSubmit(async () => {
    const schema = mode === 'app' ? totpCodeSchema : recoveryCodeSchema;
    const parsed = schema.safeParse(value.replace(/\s/g, ''));
    if (!parsed.success) {
      setError(t('errors.INVALID_TOTP'));
      return;
    }
    await secondFactor(mode === 'app' ? { code: parsed.data } : { recoveryCode: parsed.data });
    await navigate({ to: '/app' });
  });

  return (
    <AuthLayout title={t('code.title')} onSubmit={submit}>
      <div className={styles['fields']}>
        <TextField
          key={mode}
          label={mode === 'app' ? t('code.code') : t('code.recovery')}
          autoComplete="one-time-code"
          inputMode={mode === 'app' ? 'numeric' : 'text'}
          maxLength={mode === 'app' ? 6 : 11}
          autoFocus
          value={value}
          onChange={(event) => setValue(event.target.value)}
          error={error ?? undefined}
        />
      </div>
      <div className={styles['actions']}>
        <Button type="submit" fullWidth loading={pending}>
          {t('code.submit')}
        </Button>
        <div className={styles['secondary']}>
          <Button variant="quiet" onClick={() => void navigate({ to: '/sign-in' })}>
            {t('code.back')}
          </Button>
          <Button
            variant="quiet"
            onClick={() => {
              setMode(mode === 'app' ? 'recovery' : 'app');
              setValue('');
            }}
          >
            {mode === 'app' ? t('code.useRecovery') : t('code.useApp')}
          </Button>
        </div>
      </div>
    </AuthLayout>
  );
}
