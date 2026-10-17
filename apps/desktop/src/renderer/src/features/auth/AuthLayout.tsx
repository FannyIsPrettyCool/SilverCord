import { Glass, useSpring } from '@silvercord/ui';
import { motion } from 'motion/react';
import type { FormEventHandler, ReactNode } from 'react';
import styles from './auth-layout.module.css';

export interface AuthLayoutProps {
  readonly title: string;
  readonly onSubmit: FormEventHandler<HTMLFormElement>;
  readonly children: ReactNode;
}

/** One level-3 glass panel that springs in from slightly below (BRIEF §7.6). */
export function AuthLayout({ title, onSubmit, children }: AuthLayoutProps) {
  const spring = useSpring('surface');
  return (
    <main className={styles['stage']}>
      <motion.div
        className={styles['surface']}
        initial={{ y: 12, scale: 0.98 }}
        animate={{ y: 0, scale: 1 }}
        transition={spring}
      >
        <Glass
          as="form"
          level={3}
          interactive
          className={styles['panel']}
          onSubmit={onSubmit}
          noValidate
        >
          <h1 className={styles['title']}>{title}</h1>
          {children}
        </Glass>
      </motion.div>
    </main>
  );
}

export const authStyles = styles;
