import { describe, expect, it } from 'vitest';
import { contrastRatio } from '../tokens/color.ts';
import { themeToCssVariables } from '../tokens/css-variables.ts';
import { THEMES } from './index.ts';

describe.each(THEMES.map((theme) => [theme.id, theme] as const))('theme %s', (_id, theme) => {
  const { color, glass } = theme;
  const onContent = (fg: string) => contrastRatio(fg, color.content, color.base);
  const onSolidGlass = (fg: string) => contrastRatio(fg, glass.solid, color.base);

  it('meets WCAG AA for body and secondary text on the content layer', () => {
    expect(onContent(color.text)).toBeGreaterThanOrEqual(7);
    expect(onContent(color.textMuted)).toBeGreaterThanOrEqual(4.5);
  });

  it('meets WCAG AA on solid glass and for text on the accent', () => {
    expect(onSolidGlass(color.text)).toBeGreaterThanOrEqual(7);
    expect(onSolidGlass(color.textMuted)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(color.onAccent, color.accent)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps faint text readable for non-essential labels', () => {
    expect(onContent(color.textFaint)).toBeGreaterThanOrEqual(3);
  });

  it('produces a full set of CSS variables', () => {
    const vars = themeToCssVariables(theme);
    expect(vars['--radius-1']).toBe('28px');
    expect(vars['--ambient-3']).toBeDefined();
    expect(Object.values(vars).every((value) => value.length > 0)).toBe(true);
  });
});

describe('contrastRatio', () => {
  it('matches known WCAG values', () => {
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 1);
    expect(contrastRatio('#777777', '#FFFFFF')).toBeCloseTo(4.48, 1);
    expect(contrastRatio('rgba(255,255,255,0.5)', '#000000')).toBeGreaterThan(5);
  });
});
