import type { ThemeTokens } from '../tokens/theme.ts';

/** Default dark theme: deep ink-blue with a cyan → violet → magenta aurora (BRIEF §7.5). */
export const aurora: ThemeTokens = {
  id: 'aurora',
  name: 'Aurora',
  scheme: 'dark',
  color: {
    base: '#0A0C16',
    content: 'rgba(13, 15, 30, 0.84)',
    contentRaised: 'rgba(22, 25, 46, 0.9)',
    text: '#ECEFFF',
    textMuted: '#A9B1D6',
    textFaint: '#737BA3',
    accent: '#6C8CFF',
    onAccent: '#060814',
    danger: '#FF6B8B',
    success: '#4BE3A5',
    warning: '#FFC65C',
    field: 'rgba(8, 10, 22, 0.42)',
    fieldBorder: 'rgba(255, 255, 255, 0.10)',
    focusRing: '#8FA8FF',
  },
  ambient: ['#4FD8FF', '#8B7BFF', '#FF6BD6', '#6C8CFF'],
  glass: {
    // Smoky glass: a dark ink tint lets the rim and highlight carry the material.
    tint: '#0B0E22',
    tintAlpha: 0.42,
    blur: [16, 28, 44],
    saturate: 1.6,
    brightness: 0.96,
    rimAlpha: 0.3,
    shadow: '#05061A',
    grainAlpha: 0.045,
    solid: '#151931',
  },
  radiusScale: 1,
  motionIntensity: 1,
  fontScale: 1,
  density: 'cozy',
};
