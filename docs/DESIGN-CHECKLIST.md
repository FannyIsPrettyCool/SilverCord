# Design checklist

Used by the visual loop (BRIEF §11.4) and the `design-critic` agent. A screen passes
only when every item holds in each theme and each glass tier (High, Low, Solid).

## Legibility
- [ ] Body text contrast ≥ 4.5:1 against its actual rendered background (measure, don't guess)
- [ ] Message text sits on the quieter content surface, never directly on high-blur glass
- [ ] Timestamps and counters use tabular numerals
- [ ] Text scales cleanly at 90%–150% font scale

## Glass
- [ ] Every glass surface has something to refract (ambient layer visible behind it)
- [ ] Specular rim present, brighter top-left, follows pointer on hover-capable surfaces
- [ ] No nested `backdrop-filter` elements
- [ ] ≤ 10 refractive (SVG displacement) elements on screen in High tier
- [ ] Shadows tinted from ambient hue, never pure black
- [ ] Solid tier is fully opaque and still reads as the same design

## Shape & rhythm
- [ ] Radii nested concentrically (28 → 20 → 14 → 10), pills for controls, no sharp corners
- [ ] Spacing on the 4px grid, with deliberate rhythm (not uniform everywhere)
- [ ] Hierarchy from scale, weight, density and light, not from boxing everything in cards

## Motion
- [ ] Interactive elements use springs (no linear/default ease)
- [ ] Only `transform`/`opacity` animate
- [ ] Reduced-motion swaps springs for short fades
- [ ] Frame time ≤ 16.6 ms during the interaction (trace reviewed)

## Copy (BRIEF §7.8, hard rules)
- [ ] Subtraction pass done: every non-interactive, non-data text node listed and justified or deleted
- [ ] Labels ≤ 3 words; no explanatory sentences outside settings help and errors
- [ ] No eyebrow labels, numbered section markers, decorative pills, tinted-square icon grids,
      fake stats, gradient text, italic-serif hero words, uniform card grids, emoji-as-icons,
      lorem or "Welcome back!"-style filler
- [ ] No brief wording reused as UI copy
- [ ] All strings come from i18n catalogs (EN + FR)

## Accessibility
- [ ] Full keyboard path; focus ring visible on glass and solid surfaces
- [ ] Roles and labels on every interactive element
- [ ] `prefers-reduced-transparency` → Solid tier
