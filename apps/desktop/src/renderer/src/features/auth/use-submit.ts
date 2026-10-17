import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage } from './error-message.ts';

/** Shared submit state: pending flag and the form-level error message. */
export function useSubmit(action: () => Promise<void>) {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await action();
    } catch (failure) {
      setError(errorMessage(t, failure));
    } finally {
      setPending(false);
    }
  };
  return { pending, error, setError, submit };
}
