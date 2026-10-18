import type { BadgeDefinition, BadgeVisual } from '@silvercord/protocol';

export function badgeVisual(badge: BadgeDefinition): BadgeVisual {
  if (badge.visual) return badge.visual;
  const presets: Record<BadgeDefinition['rarity'], BadgeVisual> = {
    common: { effect: 'none', particles: 'none', color: null, intensity: 1 },
    uncommon: { effect: 'aurora', particles: 'none', color: null, intensity: 1 },
    rare: { effect: 'orbit', particles: 'snow', color: null, intensity: 1 },
    epic: { effect: 'aurora', particles: 'stars', color: null, intensity: 2 },
    legendary: { effect: 'ember', particles: 'sparks', color: null, intensity: 2 },
    mythic: { effect: 'prism', particles: 'stars', color: null, intensity: 3 },
  };
  return presets[badge.rarity];
}
