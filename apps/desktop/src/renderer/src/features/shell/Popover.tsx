import { Glass } from '@silvercord/ui';
import { AnimatePresence, motion } from 'motion/react';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import styles from './popover.module.css';

/**
 * Anchored glass popover: opens from its trigger, closes on Escape, outside click or after an
 * action, and returns focus to the trigger.
 */
export function Popover({
  trigger,
  children,
  placement = 'top-start',
}: {
  readonly trigger: (props: {
    open: boolean;
    toggle: () => void;
    'aria-expanded': boolean;
    'aria-controls': string;
  }) => ReactNode;
  readonly children: (close: () => void) => ReactNode;
  readonly placement?: 'top-start' | 'bottom-end' | 'bottom-start';
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        root.current?.querySelector<HTMLElement>('[aria-controls]')?.focus();
      }
    };
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);
  return (
    <div ref={root} className={styles['root']}>
      {trigger({
        open,
        toggle: () => setOpen((value) => !value),
        'aria-expanded': open,
        'aria-controls': id,
      })}
      <AnimatePresence>
        {open ? (
          <motion.div
            id={id}
            className={styles['panel']}
            data-placement={placement}
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 460, damping: 30 }}
          >
            <Glass level={3}>{children(() => setOpen(false))}</Glass>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
