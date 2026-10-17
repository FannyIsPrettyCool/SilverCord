import { emailSchema, passwordSchema, usernameSchema } from '@silvercord/protocol';
import { Button, Checkbox, TextField } from '@silvercord/ui';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DesktopError } from '../../desktop.ts';
import { detectLocale } from '../../i18n/i18n.ts';
import { useSession } from '../../session/session-store.ts';
import { AuthLayout, authStyles as styles } from './AuthLayout.tsx';
import { errorMessage } from './error-message.ts';
import { useSubmit } from './use-submit.ts';

type Field = 'email' | 'username' | 'password' | 'inviteCode' | 'age';

export function RegisterScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const register = useSession((s) => s.register);
  const [values, setValues] = useState({
    email: '',
    username: '',
    displayName: '',
    password: '',
    inviteCode: '',
  });
  const [age, setAge] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const set = (key: keyof typeof values) => (event: { target: { value: string } }) =>
    setValues((current) => ({ ...current, [key]: event.target.value }));

  const { pending, error, setError, submit } = useSubmit(async () => {
    const found: Partial<Record<Field, string>> = {};
    if (!emailSchema.safeParse(values.email).success) found.email = t('field.email');
    if (!usernameSchema.safeParse(values.username).success) found.username = t('field.username');
    if (!passwordSchema.safeParse(values.password).success)
      found.password = t('field.passwordLength');
    if (!age) found.age = t('field.required');
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    try {
      await register({
        email: values.email,
        username: values.username,
        password: values.password,
        ...(values.displayName.trim() ? { displayName: values.displayName.trim() } : {}),
        ...(values.inviteCode.trim() ? { inviteCode: values.inviteCode.trim() } : {}),
        ageConfirmed: true,
        locale: detectLocale(),
      });
      await navigate({ to: '/app' });
    } catch (failure) {
      // Server errors about a specific field are shown under that field.
      if (
        failure instanceof DesktopError &&
        failure.field &&
        ['email', 'username', 'inviteCode'].includes(failure.field)
      ) {
        setErrors({ [failure.field]: errorMessage(t, failure) });
        setError(null);
        return;
      }
      throw failure;
    }
  });

  return (
    <AuthLayout title={t('register.title')} onSubmit={submit}>
      <div className={styles['fields']}>
        <TextField
          label={t('register.email')}
          type="email"
          autoComplete="email"
          autoFocus
          value={values.email}
          onChange={set('email')}
          error={errors.email}
        />
        <TextField
          label={t('register.username')}
          autoComplete="username"
          value={values.username}
          onChange={set('username')}
          error={errors.username}
        />
        <TextField
          label={t('register.displayName')}
          autoComplete="nickname"
          value={values.displayName}
          onChange={set('displayName')}
        />
        <TextField
          label={t('register.password')}
          type="password"
          autoComplete="new-password"
          value={values.password}
          onChange={set('password')}
          error={errors.password}
        />
        <TextField
          label={t('register.invite')}
          autoComplete="off"
          value={values.inviteCode}
          onChange={set('inviteCode')}
          error={errors.inviteCode}
        />
        <Checkbox checked={age} onCheckedChange={setAge} required>
          {t('register.age')}
        </Checkbox>
        {errors.age ? (
          <p className={styles['formError']} role="alert">
            {errors.age}
          </p>
        ) : null}
      </div>
      <div className={styles['actions']}>
        {error ? (
          <p className={styles['formError']} role="alert">
            {error}
          </p>
        ) : null}
        <Button type="submit" fullWidth loading={pending}>
          {t('register.submit')}
        </Button>
        <div className={styles['secondary']}>
          <Button variant="quiet" onClick={() => void navigate({ to: '/sign-in' })}>
            {t('register.signIn')}
          </Button>
        </div>
      </div>
    </AuthLayout>
  );
}
