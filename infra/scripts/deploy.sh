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
# Keep the same per-instance lock across backup, migration and replacement.
source "$root/infra/scripts/ops-lock.sh"
image_of() {
  local container
  container=$("${compose[@]}" ps -q "$1")
  [[ -z "$container" ]] || docker inspect --format '{{.Config.Image}}' "$container"
}
previous_image=$(image_of api)
previous_decoder=$(image_of media-decoder)
export SILVERCORD_IMAGE="silvercord-api:$revision"
export SILVERCORD_DECODER_IMAGE="silvercord-decoder:$revision"
docker build --file infra/Dockerfile.server --target api --tag "$SILVERCORD_IMAGE" .
docker build --file infra/Dockerfile.server --target decoder --tag "$SILVERCORD_DECODER_IMAGE" .
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
    [[ -z "$previous_decoder" ]] || export SILVERCORD_DECODER_IMAGE="$previous_decoder"
    "${compose[@]}" up -d --no-deps --wait --wait-timeout 90 api worker media-decoder
    printf 'New API failed health checks; previous image restored. Database migrations were not reversed.\n' >&2
  else
    printf 'First deployment failed; there is no previous API image to restore.\n' >&2
  fi
  exit 1
fi
# Staging projects keep their own moving tag so they never retarget production's.
project=$(sed -n 's/^COMPOSE_PROJECT_NAME=//p' "$env_file" | tail -n 1)
current=${project:+$project-}current
docker tag "$SILVERCORD_IMAGE" "silvercord-api:$current"
docker tag "$SILVERCORD_DECODER_IMAGE" "silvercord-decoder:$current"
printf 'Deployed %s; check public HTTPS and gateway after Caddy/DNS configuration.\n' "$revision"
