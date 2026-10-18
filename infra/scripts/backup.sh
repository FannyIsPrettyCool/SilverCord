#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

if [[ $# != 2 ]]; then
  printf 'Usage: bash backup.sh /absolute/production.env /absolute/new-backup.dump\n' >&2
  exit 2
fi
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
env_file=$(realpath -e -- "$1")
[[ "$env_file" != "$root"/* ]] || { printf 'Keep production secrets outside the checkout.\n' >&2; exit 2; }
[[ -f "$env_file" ]] || exit 2
mode=$(stat -c '%a' -- "$env_file")
(( (8#$mode & 077) == 0 )) || { printf 'Environment file must be private (chmod 600).\n' >&2; exit 2; }
unset POSTGRES_PASSWORD DATABASE_PASSWORD JWT_SECRET TOTP_ENCRYPTION_KEY SMTP_URL MAIL_FROM COMPOSE_PROFILES
compose=(docker compose --env-file "$env_file" -f "$root/infra/docker-compose.prod.yml")
source "$root/infra/scripts/ops-lock.sh"
directory=$(realpath -e -- "$(dirname -- "$2")")
name=$(basename -- "$2")
[[ "$2" == /* && "$name" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]*\.dump$ ]] || exit 2
output="$directory/$name"
media_name="${name%.dump}.media.tar"
[[ ! -e "$output" && ! -e "$output.sha256" && ! -e "$directory/$media_name" ]] ||
  { printf 'Backup target already exists.\n' >&2; exit 2; }
running=()
running_services=$("${compose[@]}" ps --status running --services)
while IFS= read -r service; do
  case "$service" in api|worker) running+=("$service");; esac
done <<< "$running_services"
temporary=$(mktemp -- "$directory/.silvercord-backup.XXXXXXXX")
temporary_media=$(mktemp -- "$directory/.silvercord-media.XXXXXXXX")
resume() {
  local status=$?
  trap - EXIT
  if (( ${#running[@]} )); then
    "${compose[@]}" start --wait --wait-timeout 120 "${running[@]}" || status=1
  fi
  rm -f -- "$temporary" "$temporary_media"
  exit "$status"
}
trap resume EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
# Drain both writers before taking either snapshot. This deliberately causes a short
# reconnect window; restarting only previously running services also applies on failure.
if (( ${#running[@]} )); then
  "${compose[@]}" stop --timeout 60 "${running[@]}"
fi
"${compose[@]}" exec -T postgres pg_dump -U postgres -d silvercord \
  --format=custom --no-owner --no-acl > "$temporary"
# Parse the archive before publishing it; pg_dump alone does not test recovery.
"${compose[@]}" exec -T postgres pg_restore --list < "$temporary" > /dev/null
# Media lives in a local volume (ADR-0009); archive it beside the database dump.
"${compose[@]}" run --rm --no-deps -T --entrypoint tar api -C /data/media -cf - . > "$temporary_media"
ln -- "$temporary" "$output"
ln -- "$temporary_media" "$directory/$media_name"
(cd -- "$directory" && set -o noclobber && sha256sum -- "$name" "$media_name" > "$name.sha256")
printf 'Backup and checksum created: %s\n' "$output"
