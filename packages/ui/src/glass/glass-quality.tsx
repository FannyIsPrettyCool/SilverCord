import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { GlassQuality, GlassTier } from '../tokens/theme.ts';
import { createFrameGovernor } from './frame-governor.ts';
import { startFrameSampling } from './frame-sampler.ts';

/** Concurrent refractive elements are capped: each costs a full-size SVG filter pass. */
export const MAX_REFRACTIVE_ELEMENTS = 10;

interface GlassQualityState {
  readonly tier: GlassTier;
  /** Reserves a refraction slot; returns a release function, or null when the budget is spent. */
  readonly claimRefraction: () => (() => void) | null;
}

const GlassQualityContext = createContext<GlassQualityState>({
  tier: 'low',
  claimRefraction: () => null,
});

function usePrefersReducedTransparency(): boolean {
  const query = '(prefers-reduced-transparency: reduce)';
  const [reduce, setReduce] = useState(
    () => typeof matchMedia !== 'undefined' && matchMedia(query).matches,
  );
  useEffect(() => {
    const list = matchMedia(query);
    const onChange = () => setReduce(list.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, []);
  return reduce;
}

/** Runs the frame governor while the window is visible and focused (BRIEF §7.2 Auto tier). */
function useGovernedTier(enabled: boolean): GlassTier {
  const [tier, setTier] = useState<GlassTier>('high');
  useEffect(() => {
    if (!enabled) return;
    const governor = createFrameGovernor('high');
    return startFrameSampling((frameMs) => {
      const next = governor.record(frameMs);
      setTier((current) => (current === next ? current : next));
    });
  }, [enabled]);
  return tier;
}

export interface GlassQualityProviderProps {
  readonly quality: GlassQuality;
  readonly children: ReactNode;
  /** Element receiving `data-glass-tier`; defaults to `<html>`. */
  readonly root?: HTMLElement;
}

export function GlassQualityProvider({ quality, children, root }: GlassQualityProviderProps) {
  const reducedTransparency = usePrefersReducedTransparency();
  const governed = useGovernedTier(quality === 'auto' && !reducedTransparency);
  const tier: GlassTier = reducedTransparency ? 'solid' : quality === 'auto' ? governed : quality;
  const used = useRef(0);

  useEffect(() => {
    const element = root ?? document.documentElement;
    element.dataset['glassTier'] = tier;
  }, [tier, root]);

  const value = useMemo<GlassQualityState>(
    () => ({
      tier,
      claimRefraction: () => {
        if (used.current >= MAX_REFRACTIVE_ELEMENTS) return null;
        used.current += 1;
        let released = false;
        return () => {
          if (released) return;
          released = true;
          used.current -= 1;
        };
      },
    }),
    [tier],
  );
  return <GlassQualityContext.Provider value={value}>{children}</GlassQualityContext.Provider>;
}

export function useGlassQuality(): GlassQualityState {
  return useContext(GlassQualityContext);
}
