#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

if [[ $# != 2 ]]; then
  printf 'Usage: bash deploy.sh /absolute/production.env /absolute/existing-backup-directory\n' >&2
  exit 2
fi
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
env_file=$(realpath -e -- "$1")
[[ "$env_file" != "$root"/* ]] || { printf 'Keep production secrets outside the checkout.\n' >&2; exit 2; }
backup_directory=$(realpath -e -- "$2")
[[ "$1" == /* && "$2" == /* && -f "$env_file" && -d "$backup_directory" ]] || exit 2
mode=$(stat -c '%a' -- "$env_file")
(( (8#$mode & 077) == 0 )) || { printf 'Environment file must be private (chmod 600).\n' >&2; exit 2; }
cd -- "$root"
[[ -z "$(GIT_OPTIONAL_LOCKS=0 git status --porcelain)" ]] || { printf 'Commit changes before deploying.\n' >&2; exit 2; }
revision=$(git rev-parse --verify HEAD)
unset POSTGRES_PASSWORD DATABASE_PASSWORD JWT_SECRET TOTP_ENCRYPTION_KEY SMTP_URL MAIL_FROM COMPOSE_PROFILES
compose=(docker compose --env-file "$env_file" -f "$root/infra/docker-compose.prod.yml")
"${compose[@]}" config --quiet
# Only one deploy/backup-migration sequence may run at once.
exec 9> "$backup_directory/.deploy.lock"
flock -n 9 || { printf 'Another deployment is running.\n' >&2; exit 2; }
previous_container=$("${compose[@]}" ps -q api)
previous_image=
if [[ -n "$previous_container" ]]; then
  previous_image=$(docker inspect --format '{{.Config.Image}}' "$previous_container")
fi
export SILVERCORD_IMAGE="silvercord-api:$revision"
docker build --file infra/Dockerfile.server --tag "$SILVERCORD_IMAGE" .
"${compose[@]}" up -d --wait --wait-timeout 120 postgres valkey
bash "$root/infra/scripts/backup.sh" "$env_file" \
  "$backup_directory/$(date -u +%Y%m%dT%H%M%SZ)-$revision.dump"
"${compose[@]}" run --rm --no-deps db-init
if ! "${compose[@]}" run --rm --no-deps api node src/db/migrate-cli.ts; then
  printf 'Migration failed; the existing API was not replaced. Review the backup and migration logs.\n' >&2
  exit 1
fi
if ! "${compose[@]}" up -d --wait --wait-timeout 120; then
  if [[ -n "$previous_image" ]]; then
    export SILVERCORD_IMAGE="$previous_image"
    "${compose[@]}" up -d --no-deps --wait --wait-timeout 90 api
    printf 'New API failed health checks; previous image restored. Database migrations were not reversed.\n' >&2
  else
    printf 'First deployment failed; there is no previous API image to restore.\n' >&2
  fi
  exit 1
fi
docker tag "$SILVERCORD_IMAGE" silvercord-api:current
printf 'Deployed %s; check public HTTPS and gateway after Caddy/DNS configuration.\n' "$revision"
