#!/usr/bin/env bash
# Linux regression test with a fake Compose boundary; never connects to a Docker host.
set -Eeuo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
scratch=$(mktemp -d)
trap 'rm -rf -- "$scratch"' EXIT
mkdir "$scratch/bin"
printf 'TEST_ONLY=true\n' > "$scratch/production.env"
chmod 600 "$scratch/production.env"
export MOCK_LOG="$scratch/calls" MOCK_RUNNING=$'api\nworker' MOCK_FAIL=''
cat > "$scratch/bin/docker" <<'MOCK'
#!/usr/bin/env bash
set -eu
shift 5 # compose --env-file ENV -f COMPOSE; next argument is the command
command=$1; shift
case "$command" in
  ps) printf '%s\n' "$MOCK_RUNNING";;
  stop|start) printf '%s %s\n' "$command" "$*" >> "$MOCK_LOG"
    [[ "$MOCK_FAIL" != "$command" ]];;
  exec)
    if [[ "$*" == *pg_dump* ]]; then
      printf 'dump\n' >> "$MOCK_LOG"
      [[ "$MOCK_FAIL" != dump ]] || exit 1
      printf 'database\n'
    else
      printf 'validate\n' >> "$MOCK_LOG"
      cat > /dev/null
    fi;;
  run) printf 'media\n' >> "$MOCK_LOG"; printf 'media\n';;
  *) exit 20;;
esac
MOCK
chmod +x "$scratch/bin/docker"
export PATH="$scratch/bin:$PATH"
run_backup() {
  bash "$root/infra/scripts/backup.sh" "$scratch/production.env" "$scratch/$1.dump"
}
run_backup success
printf 'stop --timeout 60 api worker\ndump\nvalidate\nmedia\nstart --wait --wait-timeout 120 api worker\n' > "$scratch/expected"
cmp "$scratch/expected" "$MOCK_LOG"
(cd "$scratch" && sha256sum --check success.dump.sha256)
if run_backup success; then echo 'Overwrote a backup' >&2; exit 1; fi
for failure in dump stop; do
  : > "$MOCK_LOG"
  export MOCK_FAIL="$failure"
  if run_backup "failed-$failure"; then echo 'Expected backup failure' >&2; exit 1; fi
  [[ ! -e "$scratch/failed-$failure.dump" ]]
  [[ "$(tail -n 1 "$MOCK_LOG")" == 'start --wait --wait-timeout 120 api worker' ]]
done
: > "$MOCK_LOG"
export MOCK_RUNNING=worker MOCK_FAIL=''
run_backup worker-only
[[ "$(head -n 1 "$MOCK_LOG")" == 'stop --timeout 60 worker' ]]
[[ "$(tail -n 1 "$MOCK_LOG")" == 'start --wait --wait-timeout 120 worker' ]]
# A deploy keeps its inherited lock while the nested backup runs.
bash -c 'env_file=$1; source "$2/infra/scripts/ops-lock.sh"; bash "$2/infra/scripts/backup.sh" "$1" "$3/inherited.dump"' \
  bash "$scratch/production.env" "$root" "$scratch"
(
  exec 9> "$scratch/production.env.ops.lock"
  flock -n 9
  # Closing the inherited fd models a separate scheduler process.
  if run_backup locked 9>&-; then echo 'Concurrent backup acquired the lock' >&2; exit 1; fi
)
printf 'Backup regressions passed.\n'
