import { Glass, useSpring } from '@silvercord/ui';
import { AnimatePresence, motion } from 'motion/react';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import styles from './anchored-panel.module.css';

const MARGIN = 12;
const GAP = 8;
const TOP_MARGIN = 48;

/** Above the trigger when it sits in the lower half, else below; clamped to the window. */
export function placePanel(
  anchor: Pick<DOMRect, 'top' | 'bottom' | 'left' | 'right'>,
  size: { readonly width: number; readonly height: number },
  viewport = { width: window.innerWidth, height: window.innerHeight },
) {
  const above = anchor.top > viewport.height / 2;
  const top = above
    ? Math.max(TOP_MARGIN, anchor.top - GAP - size.height)
    : Math.min(anchor.bottom + GAP, viewport.height - size.height - MARGIN);
  const left = Math.min(
    Math.max(MARGIN, anchor.right - size.width),
    viewport.width - size.width - MARGIN,
  );
  return { top, left, origin: above ? 'right bottom' : 'right top' };
}

/**
 * A trigger plus a portalled glass panel (pickers, menus) that lists and clipped containers can
 * never cut off. Escape and outside presses close it; focus returns to the trigger.
 */
export function AnchoredPanel({
  trigger,
  children,
  label,
  onOpenChange,
}: {
  readonly trigger: (props: {
    readonly ref: (element: HTMLButtonElement | null) => void;
    readonly onClick: () => void;
    readonly 'aria-expanded': boolean;
    readonly 'aria-haspopup': 'dialog';
  }) => ReactNode;
  readonly children: (close: () => void) => ReactNode;
  readonly label: string;
  readonly onOpenChange?: (open: boolean) => void;
}) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [position, setPosition] = useState<ReturnType<typeof placePanel> | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const spring = useSpring('surface');
  useEffect(() => {
    onOpenChange?.(anchor !== null);
  }, [anchor, onOpenChange]);
  const close = useCallback(() => {
    setAnchor(null);
    triggerRef.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (!anchor || !panel.current) return;
    setPosition(
      placePanel(anchor, { width: panel.current.offsetWidth, height: panel.current.offsetHeight }),
    );
  }, [anchor]);

  useEffect(() => {
    if (!anchor) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !triggerRef.current?.contains(target))
        setAnchor(null);
    };
    const onResize = () => setAnchor(null);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointer);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('resize', onResize);
    };
  }, [anchor, close]);

  return (
    <>
      {trigger({
        ref: (element) => {
          triggerRef.current = element;
        },
        onClick: () =>
          setAnchor((current) =>
            current ? null : (triggerRef.current?.getBoundingClientRect() ?? null),
          ),
        'aria-expanded': anchor !== null,
        'aria-haspopup': 'dialog',
      })}
      {createPortal(
        <AnimatePresence>
          {anchor ? (
            <motion.div
              ref={panel}
              id={id}
              role="dialog"
              aria-label={label}
              className={styles['panel']}
              style={{
                top: position?.top ?? -9999,
                left: position?.left ?? -9999,
                transformOrigin: position?.origin ?? 'right bottom',
              }}
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={spring}
            >
              <Glass level={3} className={styles['glass']}>
                {children(close)}
              </Glass>
            </motion.div>
          ) : null}
        </AnimatePresence>,
        triggerRef.current?.closest('dialog') ?? document.body,
      )}
    </>
  );
}
