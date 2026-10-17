/**
 * A theme is a plain JSON-serializable token set (BRIEF §6.9); everything visual derives from it
 * through CSS custom properties, so the theme editor (phase 6) can edit any value live.
 */
export interface ThemeTokens {
  readonly id: string;
  readonly name: string;
  readonly scheme: 'dark' | 'light';
  readonly color: {
    /** Window base under the ambient layer. */
    readonly base: string;
    /** Quiet, mostly opaque surface for message text and content (the content layer). */
    readonly content: string;
    readonly contentRaised: string;
    readonly text: string;
    readonly textMuted: string;
    readonly textFaint: string;
    readonly accent: string;
    /** Text on top of `accent`. */
    readonly onAccent: string;
    readonly danger: string;
    readonly success: string;
    readonly warning: string;
    /** Field fill inside glass (never blurred: no nested backdrop filters). */
    readonly field: string;
    readonly fieldBorder: string;
    readonly focusRing: string;
  };
  /** Ambient aurora palette, 3–4 colours, slowest-moving first. */
  readonly ambient: readonly string[];
  readonly glass: {
    /** Tint laid over the backdrop. */
    readonly tint: string;
    readonly tintAlpha: number;
    /** Blur radius in px for glass levels 1, 2, 3. */
    readonly blur: readonly [number, number, number];
    readonly saturate: number;
    readonly brightness: number;
    readonly rimAlpha: number;
    /** Hue used for tinted shadows (never pure black). */
    readonly shadow: string;
    readonly grainAlpha: number;
    /** Opaque stand-in for glass in the Solid tier. */
    readonly solid: string;
  };
  /** Multiplier on the concentric radius scale 28 / 20 / 14 / 10. */
  readonly radiusScale: number;
  /** 0 = no motion, 1 = default amplitudes. */
  readonly motionIntensity: number;
  readonly fontScale: number;
  readonly density: 'cozy' | 'compact';
}

export type GlassTier = 'high' | 'low' | 'solid';
export type GlassQuality = GlassTier | 'auto';
