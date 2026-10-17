import { emailSchema } from '@silvercord/protocol';
import { Button, TextField } from '@silvercord/ui';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { desktop, unwrap } from '../../desktop.ts';
import { AuthLayout, authStyles as styles } from './AuthLayout.tsx';
import { useSubmit } from './use-submit.ts';

/** Requests a reset link. The server always answers 202, so success says nothing about the address. */
export function ForgotPasswordScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [sent, setSent] = useState(false);

  const { pending, error, submit } = useSubmit(async () => {
    if (!emailSchema.safeParse(email).success) {
      setFieldError(t('field.email'));
      return;
    }
    setFieldError(undefined);
    await unwrap(desktop().auth.forgotPassword({ email }));
    setSent(true);
  });

  return (
    <AuthLayout title={t('forgot.title')} onSubmit={submit}>
      <div className={styles['fields']}>
        <TextField
          label={t('forgot.email')}
          type="email"
          autoComplete="email"
          autoFocus
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={fieldError}
          disabled={sent}
        />
      </div>
      <div className={styles['actions']}>
        {error ? (
          <p className={styles['formError']} role="alert">
            {error}
          </p>
        ) : null}
        {sent ? (
          <p className={styles['note']} role="status">
            {t('forgot.sent')}
          </p>
        ) : (
          <Button type="submit" fullWidth loading={pending}>
            {t('forgot.submit')}
          </Button>
        )}
        <div className={styles['secondary']}>
          <Button variant="quiet" onClick={() => void navigate({ to: '/sign-in' })}>
            {t('forgot.back')}
          </Button>
        </div>
      </div>
    </AuthLayout>
  );
}
