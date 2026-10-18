#!/usr/bin/env bash
# Sourced after env_file is canonicalized. Deploy and standalone backups share one lock.
# Descriptor 9 is inherited by deploy's backup child, retaining the same flock throughout.
ops_lock="$env_file.ops.lock"
if [[ ! -e /proc/self/fd/9 || ! /proc/self/fd/9 -ef "$ops_lock" ]]; then
  exec 9> "$ops_lock"
fi
flock -n 9 || { printf 'Another deployment or backup is running.\n' >&2; exit 2; }
