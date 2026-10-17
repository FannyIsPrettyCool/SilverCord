import { Button, TextField } from '@silvercord/ui';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSession } from '../../session/session-store.ts';
import { AuthLayout, authStyles as styles } from './AuthLayout.tsx';
import { useSubmit } from './use-submit.ts';

export function SignInScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const signIn = useSession((s) => s.signIn);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ login?: string; password?: string }>({});

  const { pending, error, submit } = useSubmit(async () => {
    const errors = {
      ...(login.trim() ? {} : { login: t('field.required') }),
      ...(password ? {} : { password: t('field.required') }),
    };
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    const outcome = await signIn(login, password);
    await navigate({ to: outcome === 'mfa-required' ? '/sign-in/code' : '/app' });
  });

  return (
    <AuthLayout title={t('signIn.title')} onSubmit={submit}>
      <div className={styles['fields']}>
        <TextField
          label={t('signIn.login')}
          autoComplete="username"
          autoFocus
          value={login}
          onChange={(event) => setLogin(event.target.value)}
          error={fieldErrors.login}
        />
        <TextField
          label={t('signIn.password')}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={fieldErrors.password}
        />
      </div>
      <div className={styles['actions']}>
        {error ? (
          <p className={styles['formError']} role="alert">
            {error}
          </p>
        ) : null}
        <Button type="submit" fullWidth loading={pending}>
          {t('signIn.submit')}
        </Button>
        <div className={styles['secondary']}>
          <Button variant="quiet" onClick={() => void navigate({ to: '/register' })}>
            {t('signIn.register')}
          </Button>
          <Button variant="quiet" onClick={() => void navigate({ to: '/forgot-password' })}>
            {t('signIn.forgot')}
          </Button>
        </div>
      </div>
    </AuthLayout>
  );
}
