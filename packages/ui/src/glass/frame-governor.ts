import type { GlassTier } from '../tokens/theme.ts';

const ORDER: readonly GlassTier[] = ['solid', 'low', 'high'];

export interface GovernorOptions {
  /** Average frame time above which the tier steps down. */
  readonly slowFrameMs: number;
  /** Average frame time below which the tier may step back up. */
  readonly fastFrameMs: number;
  /** Frames per evaluation window. */
  readonly windowFrames: number;
  /** Consecutive fast windows required before upgrading (hysteresis). */
  readonly upgradeAfterWindows: number;
}

export const DEFAULT_GOVERNOR: GovernorOptions = {
  slowFrameMs: 22,
  fastFrameMs: 13,
  windowFrames: 90,
  upgradeAfterWindows: 6,
};

/**
 * Pure tier controller for the Auto quality setting (BRIEF §7.2): feed it frame durations, it
 * returns the tier to use. Downgrades fast, upgrades slowly, never above `ceiling`.
 */
export function createFrameGovernor(
  ceiling: GlassTier,
  options: GovernorOptions = DEFAULT_GOVERNOR,
) {
  let tier: GlassTier = ceiling;
  let samples: number[] = [];
  let fastWindows = 0;
  const step = (delta: -1 | 1) => {
    const index = Math.min(ORDER.indexOf(ceiling), Math.max(0, ORDER.indexOf(tier) + delta));
    tier = ORDER[index] ?? tier;
  };

  return {
    get tier() {
      return tier;
    },
    /** Records one frame; returns the (possibly new) tier. */
    record(frameMs: number): GlassTier {
      // A frame over a second means the window was hidden or the machine slept: ignore it.
      if (frameMs > 1000) return tier;
      samples.push(frameMs);
      if (samples.length < options.windowFrames) return tier;
      const average = samples.reduce((sum, value) => sum + value, 0) / samples.length;
      samples = [];
      if (average > options.slowFrameMs) {
        fastWindows = 0;
        step(-1);
      } else if (average < options.fastFrameMs) {
        fastWindows += 1;
        if (fastWindows >= options.upgradeAfterWindows) {
          fastWindows = 0;
          step(1);
        }
      } else {
        fastWindows = 0;
      }
      return tier;
    },
  };
}
