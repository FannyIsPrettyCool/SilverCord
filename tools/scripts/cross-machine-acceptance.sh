#!/usr/bin/env bash
# Windows Git Bash orchestrates one Windows Electron and one disposable Linux Electron.
# Only the loopback staging stack at 14100 is reachable through the dedicated local tunnel.
set -Eeuo pipefail
if ! command -v pnpm >/dev/null; then pnpm() { pnpm.cmd "$@"; }; fi
host=${SILVERCORD_IT_HOST:-ubuntu@145.239.79.30}
key=${SILVERCORD_IT_KEY:-$HOME/.ssh/islandmon_ovh}
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
[[ "$(node -p 'process.platform')" == win32 ]] || { printf 'Run from Windows Git Bash.\n' >&2; exit 2; }
marker="machine-$(node -p 'crypto.randomUUID()')"
run="sc-acceptance-$(date -u +%Y%m%d%H%M%S)-$$"
remote="/srv/silvercord-acceptance/$run"
output="$root/.artifacts/cross-machine/$run"
ssh_cmd=(ssh -o BatchMode=yes -i "$key" "$host")
archive=$(mktemp)
tunnel_pid=''
linux_pid=''
mkdir -p "$output/windows" "$output/linux"
cleanup() {
  local status=$?
  trap - EXIT
  [[ -z "$tunnel_pid" ]] || kill "$tunnel_pid" 2>/dev/null || true
  "${ssh_cmd[@]}" "sudo -n docker rm -f '$run-linux' >/dev/null 2>&1 || true; test ! -d '$remote/evidence' || sudo -n tar -C '$remote/evidence' -czf - ." |
    tar -xzf - -C "$output/linux" 2>/dev/null || true
  [[ -z "$linux_pid" ]] || kill "$linux_pid" 2>/dev/null || true
  "${ssh_cmd[@]}" "sudo -n rm -rf -- '$remote'" || true
  rm -f -- "$archive"
  printf 'Cross-machine evidence: %s\n' "$output"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
cd -- "$root"
git rev-parse HEAD > "$output/source-sha.txt"
git diff --stat > "$output/uncommitted-source.txt"
pnpm --filter @silvercord/desktop build
# Read only: ensure the target is staging and the seed identities exist before creating sessions.
"${ssh_cmd[@]}" "sudo -n docker compose --env-file /etc/silvercord/staging.env -f /srv/silvercord-staging/infra/docker-compose.prod.yml exec -T postgres psql -U postgres -d silvercord -tAc \"SELECT username FROM users WHERE username IN ('aurora', 'tide') ORDER BY username\"" > "$output/staging-seeds.txt"
[[ "$(tr -d '\r' < "$output/staging-seeds.txt")" == $'aurora\ntide' ]] || { printf 'Private staging seed accounts missing.\n' >&2; exit 2; }
"${ssh_cmd[@]}" "curl --fail --silent http://127.0.0.1:14100/health" > "$output/staging-health.json"
(git ls-files -co --exclude-standard -z | tar --null -T - -czf "$archive")
"${ssh_cmd[@]}" "sudo -n install -d -o \"\$USER\" /srv/silvercord-acceptance && mkdir -p '$remote/source' '$remote/evidence'"
"${ssh_cmd[@]}" "tar -xzf - -C '$remote/source'" < "$archive"
# With every capability dropped, UID 0 cannot override bind-mount ownership.
"${ssh_cmd[@]}" "sudo -n chown -R 0:0 '$remote/source' '$remote/evidence'"
"${ssh_cmd[@]}" 'sudo -n docker build -t silvercord-electron-acceptance:44 -' > "$output/linux-build.log" 2>&1 <<'DOCKER'
FROM node:24.16.0-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
  ca-certificates xvfb xauth libgtk-3-0 libnss3 libasound2 libgbm1 libxss1 \
  libdrm2 libatk-bridge2.0-0 libcups2 libxkbcommon0 libx11-xcb1 dbus-x11 \
  && rm -rf /var/lib/apt/lists/*
RUN npm install --global pnpm@11.26.0
RUN apt-get update && apt-get install -y --no-install-recommends fonts-noto-color-emoji \
  && rm -rf /var/lib/apt/lists/*
DOCKER
ssh -o BatchMode=yes -o ExitOnForwardFailure=yes -i "$key" \
  -N -L 127.0.0.1:14400:127.0.0.1:14100 "$host" > "$output/tunnel.log" 2>&1 &
tunnel_pid=$!
for attempt in {1..30}; do
  curl --fail --silent http://127.0.0.1:14400/health > /dev/null && break
  kill -0 "$tunnel_pid" || { cat "$output/tunnel.log" >&2; exit 1; }
  sleep 1
done
"${ssh_cmd[@]}" "sudo -n docker run --rm --init --name '$run-linux' --network host \
  --cap-drop ALL --security-opt no-new-privileges --cpus 1 --memory 1536m --pids-limit 256 --shm-size 256m \
  -v '$remote/source:/workspace' -v '$remote/evidence:/evidence' \
  -v silvercord-it-pnpm-store:/pnpm-store -w /workspace \
  -e CI=true -e SILVERCORD_API_URL=http://127.0.0.1:14100 \
  -e SILVERCORD_ACCEPTANCE_ROLE=linux -e SILVERCORD_ACCEPTANCE_MARKER='$marker' \
  -e SILVERCORD_ACCEPTANCE_OUTPUT=/evidence \
  silvercord-electron-acceptance:44 bash -ec '
    pnpm config set store-dir /pnpm-store
    pnpm install --frozen-lockfile --ignore-scripts --filter @silvercord/desktop...
    pnpm --filter @silvercord/desktop exec install-electron
    pnpm --filter @silvercord/desktop build
    xvfb-run --auto-servernum pnpm --filter @silvercord/desktop exec playwright test \
      --config playwright.live.config.ts cross-machine.live.ts
  '" > "$output/linux-run.log" 2>&1 &
linux_pid=$!
ready=false
for attempt in {1..150}; do
  if "${ssh_cmd[@]}" "test -f '$remote/evidence/ready.json'"; then ready=true; break; fi
  kill -0 "$linux_pid" 2>/dev/null || { cat "$output/linux-run.log" >&2; exit 1; }
  sleep 2
done
[[ "$ready" == true ]] || { printf 'Linux Electron did not become ready.\n' >&2; exit 1; }
SILVERCORD_API_URL=http://127.0.0.1:14400 \
SILVERCORD_ACCEPTANCE_ROLE=windows SILVERCORD_ACCEPTANCE_MARKER="$marker" \
SILVERCORD_ACCEPTANCE_OUTPUT="$(cygpath -w "$output/windows")" \
  pnpm --filter @silvercord/desktop exec playwright test --config playwright.live.config.ts cross-machine.live.ts |
  tee "$output/windows-run.log"
wait "$linux_pid"
linux_pid=''
printf 'Both real Electron clients completed: %s\n' "$marker"
