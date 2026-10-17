import { type ComponentPropsWithoutRef, type ElementType, useRef } from 'react';
import styles from './glass.module.css';
import { useGlassQuality } from './glass-quality.tsx';
import { usePointerLight } from './use-pointer-light.ts';
import { useRefraction } from './use-refraction.ts';

export type GlassLevel = 1 | 2 | 3;

export type GlassProps<E extends ElementType = 'div'> = {
  readonly as?: E;
  /** 1: small controls · 2: panels and bars · 3: modals and large floating sheets. */
  readonly level?: GlassLevel;
  readonly pill?: boolean;
  /** Request displacement refraction (High tier only, capped). Reserve for small elements. */
  readonly refract?: boolean;
  /** Pointer-following highlight on the rim. */
  readonly interactive?: boolean;
} & Omit<ComponentPropsWithoutRef<E>, 'as'>;

/**
 * The single glass surface every floating control composes (BRIEF §7.2). Never place a Glass
 * inside another Glass: nested backdrop filters are both slow and visually muddy.
 */
export function Glass<E extends ElementType = 'div'>({
  as,
  level = 2,
  pill = false,
  refract = false,
  interactive = false,
  className,
  ...rest
}: GlassProps<E>) {
  const Component: ElementType = as ?? 'div';
  const ref = useRef<HTMLElement>(null);
  const { tier } = useGlassQuality();
  usePointerLight(ref, interactive && tier !== 'solid');
  useRefraction(ref, refract);
  const classes = [
    styles['glass'],
    level === 1 ? styles['level1'] : level === 3 ? styles['level3'] : undefined,
    pill ? styles['pill'] : undefined,
    refract ? styles['refract'] : undefined,
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return <Component ref={ref} className={classes} {...rest} />;
}
