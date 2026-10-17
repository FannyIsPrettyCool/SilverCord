import * as RadixCheckbox from '@radix-ui/react-checkbox';
import { motion } from 'motion/react';
import { type ReactNode, useId } from 'react';
import { useSpring } from '../motion/motion-preferences.tsx';
import styles from './checkbox.module.css';

export interface CheckboxProps {
  readonly checked: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
  readonly children: ReactNode;
  readonly required?: boolean;
  readonly 'aria-invalid'?: boolean;
}

/** Radix checkbox (keyboard + screen reader semantics) with a spring-drawn check. */
export function Checkbox({
  checked,
  onCheckedChange,
  children,
  required,
  'aria-invalid': invalid,
}: CheckboxProps) {
  const id = useId();
  const spring = useSpring('press');
  return (
    <label className={styles['row']} htmlFor={id}>
      <RadixCheckbox.Root
        id={id}
        className={styles['box']}
        checked={checked}
        required={required ?? false}
        aria-invalid={invalid}
        onCheckedChange={(state) => onCheckedChange(state === true)}
      >
        <RadixCheckbox.Indicator forceMount>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <motion.path
              d="M2.5 6.4 5 8.7 9.6 3.4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={false}
              animate={{ pathLength: checked ? 1 : 0, opacity: checked ? 1 : 0 }}
              transition={spring}
            />
          </svg>
        </RadixCheckbox.Indicator>
      </RadixCheckbox.Root>
      <span>{children}</span>
    </label>
  );
}
