import { type HTMLMotionProps, motion } from 'motion/react';
import type { ReactNode } from 'react';
import { useAmplitude, useSpring } from '../motion/motion-preferences.tsx';
import styles from './button.module.css';
import { Spinner } from './Spinner.tsx';

export type ButtonProps = Omit<HTMLMotionProps<'button'>, 'children'> & {
  readonly variant?: 'primary' | 'quiet';
  readonly fullWidth?: boolean;
  readonly loading?: boolean;
  readonly children: ReactNode;
};

/** Pill button with a spring press: 0.96 down, overshooting slightly on release (BRIEF §7.6). */
export function Button({
  variant = 'primary',
  fullWidth = false,
  loading = false,
  disabled,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  const press = useSpring('press');
  const depth = useAmplitude(0.04);
  const classes = [
    styles['button'],
    styles[variant],
    fullWidth ? styles['full'] : undefined,
    loading ? styles['loading'] : undefined,
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <motion.button
      type={type}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      whileTap={{ scale: 1 - depth }}
      transition={press}
      {...rest}
    >
      <span className={styles['label']}>{children}</span>
      {loading ? (
        <span className={styles['spinner']}>
          <Spinner size={18} />
        </span>
      ) : null}
    </motion.button>
  );
}
