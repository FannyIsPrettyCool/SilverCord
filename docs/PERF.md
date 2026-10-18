# Performance

Measurements against BRIEF §10.3 budgets. Each entry says what was measured, on what, and how
to reproduce it. Budgets not listed here have not been measured yet.

## Message list scroll (phase 2 acceptance: 60 fps on a 10k-message seed)

Test: `apps/desktop/e2e/live/scroll-perf.live.ts` against the loopback staging stack seeded
with `SEED_PERF_MESSAGES=10000`. It loads every page of the DM (all 10,000 messages, 656,194 px
of history), then scrolls from the top to the bottom at 360 px per animation frame (a fast
flick, about three times a typical wheel step) and records every frame interval.

| Date | Build | Frames | p50 | p95 | p99 | > 17.5 ms | > 33.4 ms |
|---|---|---|---|---|---|---|---|
| 2026-10-18 | before row optimizations | 1,939 | 20.9 ms | 34.8 ms | 69.5 ms | 78.8 % | 16.7 % |
| 2026-10-18 | lazy toolbar, cached formatters and parses | 1,939 | 6.9 ms | 7.3 ms | 14.0 ms | 0.1 % | 0 % |

Hardware: AMD Ryzen 9 5950X, Radeon RX 7800 XT, 144 Hz display, 24 GB, Windows 11, Electron 44,
glass tier Low. The ~22 rendered rows per frame are the virtualizer's window plus overscan.

What made the difference: rows mount continuously while scrolling, so per-row cost dominates.
The hover toolbar (glass surface, popover, three mutation hooks) now mounts only while a row is
hovered or focused; `Intl.DateTimeFormat` instances are cached per locale; parsed markdown is
cached by source text; rows without reactions no longer create mutation hooks.

Not yet verified: the "mid laptop" reference device of BRIEF §10.3. This workstation is well
above it; repeat the run on an integrated-GPU laptop before the phase 7 performance pass.
