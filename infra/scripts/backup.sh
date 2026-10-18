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
directory=$(realpath -e -- "$(dirname -- "$2")")
name=$(basename -- "$2")
[[ "$2" == /* && "$name" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]*\.dump$ ]] || exit 2
output="$directory/$name"
[[ ! -e "$output" && ! -e "$output.sha256" ]] || { printf 'Backup target already exists.\n' >&2; exit 2; }
temporary=$(mktemp -- "$directory/.silvercord-backup.XXXXXXXX")
trap 'rm -f -- "$temporary"' EXIT
"${compose[@]}" exec -T postgres pg_dump -U postgres -d silvercord \
  --format=custom --no-owner --no-acl > "$temporary"
# Parse the archive before publishing it; pg_dump alone does not test recovery.
"${compose[@]}" exec -T postgres pg_restore --list < "$temporary" > /dev/null
ln -- "$temporary" "$output"
(cd -- "$directory" && set -o noclobber && sha256sum -- "$name" > "$name.sha256")
printf 'Backup and checksum created: %s\n' "$output"
