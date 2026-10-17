import { withAlpha } from './color.ts';
import type { ThemeTokens } from './theme.ts';

const RADII = [28, 20, 14, 10] as const;

/** Flattens a theme into the CSS custom properties every component reads. */
export function themeToCssVariables(theme: ThemeTokens): Record<`--${string}`, string> {
  const { color, glass } = theme;
  const [blur1, blur2, blur3] = glass.blur;
  const vars: Record<`--${string}`, string> = {
    '--color-base': color.base,
    '--color-content': color.content,
    '--color-content-raised': color.contentRaised,
    '--color-text': color.text,
    '--color-text-muted': color.textMuted,
    '--color-text-faint': color.textFaint,
    '--color-accent': color.accent,
    '--color-accent-soft': withAlpha(color.accent, 0.18),
    '--color-on-accent': color.onAccent,
    '--color-danger': color.danger,
    '--color-success': color.success,
    '--color-warning': color.warning,
    '--color-field': color.field,
    '--color-field-border': color.fieldBorder,
    '--color-focus-ring': color.focusRing,
    '--glass-tint': withAlpha(glass.tint, glass.tintAlpha),
    '--glass-blur-1': `${blur1}px`,
    '--glass-blur-2': `${blur2}px`,
    '--glass-blur-3': `${blur3}px`,
    '--glass-saturate': String(glass.saturate),
    '--glass-brightness': String(glass.brightness),
    '--glass-rim': withAlpha('#FFFFFF', glass.rimAlpha),
    '--glass-rim-faint': withAlpha('#FFFFFF', glass.rimAlpha * 0.25),
    '--glass-shadow': withAlpha(glass.shadow, theme.scheme === 'dark' ? 0.55 : 0.22),
    '--glass-shadow-soft': withAlpha(glass.shadow, theme.scheme === 'dark' ? 0.3 : 0.12),
    '--glass-grain-alpha': String(glass.grainAlpha),
    '--glass-solid': glass.solid,
    '--motion-intensity': String(theme.motionIntensity),
    '--font-scale': String(theme.fontScale),
  };
  theme.ambient.forEach((value, index) => {
    vars[`--ambient-${index + 1}`] = value;
  });
  RADII.forEach((radius, index) => {
    vars[`--radius-${index + 1}`] = `${Math.round(radius * theme.radiusScale)}px`;
  });
  return vars;
}

/** Applies a theme to an element (normally `document.documentElement`). */
export function applyTheme(element: HTMLElement, theme: ThemeTokens): void {
  for (const [name, value] of Object.entries(themeToCssVariables(theme))) {
    element.style.setProperty(name, value);
  }
  element.dataset['theme'] = theme.id;
  element.style.colorScheme = theme.scheme;
}
