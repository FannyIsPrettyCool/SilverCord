import { type HTMLMotionProps, motion } from 'motion/react';
import type { ReactNode } from 'react';
import { useAmplitude, useSpring } from '../motion/motion-preferences.tsx';
import styles from './icon-button.module.css';

export type IconButtonProps = Omit<HTMLMotionProps<'button'>, 'children' | 'aria-label'> & {
  /** Required: icon-only controls must have an accessible name. */
  readonly label: string;
  readonly children: ReactNode;
};

export function IconButton({
  label,
  className,
  children,
  type = 'button',
  ...rest
}: IconButtonProps) {
  const press = useSpring('press');
  const depth = useAmplitude(0.08);
  return (
    <motion.button
      type={type}
      aria-label={label}
      title={label}
      className={[styles['iconButton'], className].filter(Boolean).join(' ')}
      whileTap={{ scale: 1 - depth }}
      transition={press}
      {...rest}
    >
      {children}
    </motion.button>
  );
}
