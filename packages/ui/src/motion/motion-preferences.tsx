import { MotionConfig, type Transition, useReducedMotion } from 'motion/react';
import { createContext, type ReactNode, useContext } from 'react';
import { REDUCED_TRANSITION, SPRINGS } from './springs.ts';

const IntensityContext = createContext(1);

export interface MotionPreferencesProps {
  /** 0–1 scale on motion amplitudes (the in-app motion slider, BRIEF §7.6). */
  readonly intensity: number;
  readonly children: ReactNode;
}

/** Honours the OS reduced-motion setting and the in-app intensity slider. */
export function MotionPreferences({ intensity, children }: MotionPreferencesProps) {
  return (
    <IntensityContext.Provider value={intensity}>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </IntensityContext.Provider>
  );
}

/** A spring preset, or a short fade when motion is reduced or turned off. */
export function useSpring(name: keyof typeof SPRINGS): Transition {
  const reduced = useReducedMotion();
  const intensity = useContext(IntensityContext);
  return reduced || intensity === 0 ? REDUCED_TRANSITION : SPRINGS[name];
}

/** Scales an amplitude (e.g. a press scale delta) by the intensity setting. */
export function useAmplitude(value: number): number {
  const reduced = useReducedMotion();
  const intensity = useContext(IntensityContext);
  return reduced ? 0 : value * intensity;
}
