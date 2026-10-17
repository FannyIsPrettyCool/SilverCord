/** Minimal colour maths for contrast checks (WCAG 2.x) without a dependency. */
export interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

export function parseColor(input: string): Rgba {
  const value = input.trim();
  const hex = /^#([0-9a-f]{3,8})$/i.exec(value)?.[1];
  if (hex) {
    const full = hex.length <= 4 ? [...hex].map((c) => c + c).join('') : hex;
    const channel = (index: number) => Number.parseInt(full.slice(index, index + 2), 16);
    return {
      r: channel(0),
      g: channel(2),
      b: channel(4),
      a: full.length === 8 ? channel(6) / 255 : 1,
    };
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(value)?.[1];
  if (rgb) {
    const [r = 0, g = 0, b = 0, a = 1] = rgb
      .split(/[\s,/]+/)
      .filter(Boolean)
      .map(Number);
    return { r, g, b, a };
  }
  throw new Error(`unsupported colour: ${input}`);
}

/** Source-over compositing of `top` onto an opaque `bottom`. */
export function composite(top: Rgba, bottom: Rgba): Rgba {
  const mix = (t: number, b: number) => t * top.a + b * (1 - top.a);
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a: 1 };
}

function luminance({ r, g, b }: Rgba): number {
  const linear = (channel: number) => {
    const c = channel / 255;
    return c <= 0.039_28 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG contrast ratio, 1–21. Translucent colours are composited onto `backdrop` first. */
export function contrastRatio(
  foreground: string,
  background: string,
  backdrop = '#000000',
): number {
  const base = parseColor(backdrop);
  const bg = composite(parseColor(background), base);
  const fg = composite(parseColor(foreground), bg);
  const [lighter, darker] = [luminance(fg), luminance(bg)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (lighter + 0.05) / (darker + 0.05);
}

export function withAlpha(color: string, alpha: number): string {
  const { r, g, b } = parseColor(color);
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha})`;
}
