import type { ThemeTokens } from '../tokens/theme.ts';
import { aurora } from './aurora.ts';
import { frost } from './frost.ts';
import { midnightEmber } from './midnight-ember.ts';

export { aurora, frost, midnightEmber };

/** Built-in presets; Tide, Mono Glass and Sakura Night arrive with the theme editor (phase 6). */
export const THEMES: readonly ThemeTokens[] = [aurora, frost, midnightEmber];

export function themeById(id: string): ThemeTokens {
  return THEMES.find((theme) => theme.id === id) ?? aurora;
}
