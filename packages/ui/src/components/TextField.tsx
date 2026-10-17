import { type ComponentPropsWithoutRef, useId } from 'react';
import styles from './text-field.module.css';

export type TextFieldProps = Omit<ComponentPropsWithoutRef<'input'>, 'id'> & {
  readonly label: string;
  readonly error?: string | undefined;
};

/** Labelled input with an announced error message. */
export function TextField({ label, error, className, ...rest }: TextFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className={[styles['field'], className].filter(Boolean).join(' ')}>
      <label className={styles['label']} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className={styles['input']}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        {...rest}
      />
      {error ? (
        <p id={errorId} className={styles['error']} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
