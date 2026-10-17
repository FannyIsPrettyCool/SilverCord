#!/bin/sh
# Lints every commit in COMMITS_FROM..HEAD. Falls back to the whole history when the
# base is missing or all zeros (first push of a branch).
set -eu
from="${COMMITS_FROM:-}"
if [ -z "$from" ] || [ "$from" = "0000000000000000000000000000000000000000" ] || ! git cat-file -e "$from^{commit}" 2>/dev/null; then
  from="$(git rev-list --max-parents=0 HEAD | tail -n 1)"
  # The root commit itself is not covered by --from, so check it explicitly.
  git log -1 --format=%B "$from" | pnpm exec commitlint
fi
pnpm exec commitlint --from "$from" --to HEAD
