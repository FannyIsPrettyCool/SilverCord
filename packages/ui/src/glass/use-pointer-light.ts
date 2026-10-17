import { type RefObject, useEffect } from 'react';

/**
 * Moves the specular highlight toward the pointer by updating `--mx/--my` once per frame
 * (BRIEF §7.2). Only CSS variables change: no layout, no React renders.
 */
export function usePointerLight(ref: RefObject<HTMLElement | null>, enabled: boolean): void {
  useEffect(() => {
    const element = ref.current;
    if (!element || !enabled) return;
    let frame = 0;
    let x = 0;
    let y = 0;
    const flush = () => {
      frame = 0;
      const rect = element.getBoundingClientRect();
      element.style.setProperty('--mx', `${((x - rect.left) / rect.width) * 100}%`);
      element.style.setProperty('--my', `${((y - rect.top) / rect.height) * 100}%`);
    };
    const onMove = (event: PointerEvent) => {
      x = event.clientX;
      y = event.clientY;
      frame ||= requestAnimationFrame(flush);
    };
    const onLeave = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      element.style.removeProperty('--mx');
      element.style.removeProperty('--my');
    };
    element.addEventListener('pointermove', onMove);
    element.addEventListener('pointerleave', onLeave);
    return () => {
      cancelAnimationFrame(frame);
      element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerleave', onLeave);
    };
  }, [ref, enabled]);
}
