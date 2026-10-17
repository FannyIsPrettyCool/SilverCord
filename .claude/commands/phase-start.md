---
description: Start a roadmap phase - baseline, specs and task plan
argument-hint: <phase number>
---

Start phase $ARGUMENTS:
1. Session start routine from `CLAUDE.md` (read PROGRESS/PLAN, git status, `pnpm verify` green).
2. Create branch `feat/<scope>-phase-$ARGUMENTS-<slug>` if work is not trivially small.
3. List the phase's tasks and acceptance criteria from `docs/PLAN.md`; flag any that need escalation (BRIEF §11.6).
4. Identify which specs/ADRs must exist first; write the first one (use the `architect` agent for schema/protocol/permission design).
5. Write the phase plan to the top of `docs/PROGRESS.md`, commit and push.
