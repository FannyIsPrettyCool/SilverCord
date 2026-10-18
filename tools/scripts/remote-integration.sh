#!/usr/bin/env bash
# Usage: remote-integration.sh [vitest filters...]
# Runs the server integration suite on a Docker host over SSH when no local daemon exists.
# The working tree (tracked + untracked, minus ignored) is copied; Postgres and Valkey run
# on a private bridge network with no published ports, and everything is removed afterwards.
set -Eeuo pipefail

host=${SILVERCORD_IT_HOST:-ubuntu@145.239.79.30}
key=${SILVERCORD_IT_KEY:-$HOME/.ssh/islandmon_ovh}
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
run="sc-it-$(date -u +%Y%m%d%H%M%S)-$$"
archive=$(mktemp)
trap 'rm -f -- "$archive"' EXIT

(cd -- "$root" && git ls-files -co --exclude-standard -z | tar --null -T - -czf "$archive")
ssh_cmd=(ssh -o BatchMode=yes -i "$key" "$host")
"${ssh_cmd[@]}" "sudo -n install -d -o \"\$USER\" /srv/silvercord-it && mkdir -p /srv/silvercord-it/$run" < /dev/null
"${ssh_cmd[@]}" "tar -xzf - -C /srv/silvercord-it/$run" < "$archive"

filters=$(printf ' %q' "$@")
"${ssh_cmd[@]}" "bash -s" <<EOF
set -Eeuo pipefail
cleanup() {
  sudo -n docker rm -f $run-pg $run-vk > /dev/null 2>&1 || true
  sudo -n docker network rm $run > /dev/null 2>&1 || true
  sudo -n rm -rf /srv/silvercord-it/$run
}
trap cleanup EXIT
sudo -n docker network create $run > /dev/null
sudo -n docker run -d --name $run-pg --network $run -e POSTGRES_PASSWORD=test \
  --tmpfs /var/lib/postgresql:rw,size=1g postgres:18.6 > /dev/null
sudo -n docker run -d --name $run-vk --network $run valkey/valkey:9.1.2 > /dev/null
until sudo -n docker exec $run-pg pg_isready -U postgres -h 127.0.0.1 > /dev/null 2>&1; do sleep 1; done
sudo -n docker run --rm --network $run \
  -v /srv/silvercord-it/$run:/workspace -v silvercord-it-pnpm-store:/pnpm-store -w /workspace \
  -e CI=true \
  -e TEST_POSTGRES_ADMIN_URL=postgres://postgres:test@$run-pg:5432/postgres \
  -e TEST_VALKEY_URL=redis://$run-vk:6379 \
  node:24.16.0-bookworm-slim sh -ec '
    npm install --global --silent pnpm@11.26.0
    pnpm config set store-dir /pnpm-store > /dev/null
    pnpm install --frozen-lockfile --ignore-scripts --filter "@silvercord/server..." > /dev/null
    cd apps/server && pnpm exec vitest run --project integration$filters
  '
EOF
