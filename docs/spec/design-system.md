# Spec: design system lifecycle

Phase 1 implements BRIEF §7: Aurora, Frost and Midnight Ember tokens, bundled fonts,
High/Low/Solid/Auto glass tiers, refraction budget and an ambient background.

- Ambient effects own and release geometry, programs and shaders. React StrictMode cleanup
  and theme changes must reuse the canvas without deliberately losing its WebGL context.
- Unexpected context loss stops animation and selects the CSS gradient fallback.
- Ambient rendering caps at 30 fps and pauses while hidden, unfocused or motion is disabled.
- Auto glass quality samples one 90-frame window, then sleeps five seconds without RAF.
  Bursts exclude pause durations; hiding, blurring and unmounting cancel frames and timers.
- Reduced transparency forces Solid. Explicit quality selections bypass the governor.
- Auth panel entrance animates transform only to preserve glass compositing.

Acceptance: lifecycle and burst-sampling regressions pass; real Electron rendering and context
loss are exercised; Storybook snapshots cover every theme/tier and app screenshots cover auth.
