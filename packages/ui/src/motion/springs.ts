import type { Transition } from 'motion/react';

/**
 * Spring presets (BRIEF §7.6). Interactive elements never use linear or default easing; reduced
 * motion swaps springs for short fades via `useSpring`.
 */
export const SPRINGS = {
  /** Button presses: snappy with a small overshoot back past 1. */
  press: { type: 'spring', stiffness: 480, damping: 24, mass: 0.6 },
  /** Panels and popovers entering. */
  surface: { type: 'spring', stiffness: 320, damping: 30, mass: 0.9 },
  /** Shared-element pills and indicators stretching to their target. */
  liquid: { type: 'spring', stiffness: 420, damping: 32, mass: 0.8 },
} as const satisfies Record<string, Transition>;

export const REDUCED_TRANSITION: Transition = { duration: 0.12, ease: 'easeOut' };
