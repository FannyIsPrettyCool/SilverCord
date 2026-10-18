#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

if [[ $# != 3 ]]; then
  printf 'Usage: bash restore.sh /absolute/production.env /absolute/backup.dump silvercord_restore_NAME\n' >&2
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
archive=$(realpath -e -- "$2")
target=$3
[[ "$2" == /* && -f "$archive" && "$target" =~ ^silvercord_restore_[a-z0-9_]{1,40}$ ]] || exit 2
name=$(basename -- "$archive")
[[ "$name" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]*\.dump$ && -f "$archive.sha256" ]] || exit 2
(cd -- "$(dirname -- "$archive")" && sha256sum --check --status -- "$name.sha256")
"${compose[@]}" exec -T postgres pg_restore --list < "$archive" > /dev/null
exists=$("${compose[@]}" exec -T postgres psql -U postgres -d postgres -tAc \
  "SELECT 1 FROM pg_database WHERE datname = '$target'")
[[ -z "$exists" ]] || { printf 'Restore target already exists; refusing to overwrite it.\n' >&2; exit 2; }
"${compose[@]}" exec -T postgres createdb -U postgres -- "$target"
"${compose[@]}" exec -T postgres pg_restore -U postgres --dbname="$target" \
  --single-transaction --exit-on-error --no-owner --no-acl < "$archive"
printf 'Restored into isolated database %s; production was not changed.\n' "$target"
printf 'Verify application data before any separately approved cutover.\n'
