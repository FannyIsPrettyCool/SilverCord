---
description: Close a roadmap phase - full verify, review, security pass, tag
argument-hint: <phase number>
---

Ship phase $ARGUMENTS:
1. `pnpm verify:full` green.
2. Run the `reviewer` agent on the phase diff (`git diff v0.<prev>.0..HEAD`) and the `security-auditor` agent; resolve every high/critical finding, log the rest in `docs/PLAN.md`.
3. Confirm every acceptance criterion of the phase in `docs/PLAN.md` with evidence (test names, screenshots, commands run).
4. Regenerate README art: `python3 tools/readme-assets/generate.py <next phase>`; update README badges.
5. Update `docs/PLAN.md`, `docs/PROGRESS.md`, `CLAUDE.md` gotchas.
6. Commit, tag `v0.$ARGUMENTS.0` with a `🔖 repo: release v0.$ARGUMENTS.0 <summary>` commit, push commits and tag.
7. Report to the human: shipped, verified, next, blocked.
