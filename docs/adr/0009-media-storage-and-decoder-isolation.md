# ADR-0009: Media storage, delivery and decoder isolation

- Status: accepted
- Date: 2026-10-18
- Scope: Phase 2 media (docs/spec/media.md) on the single shared VPS

## Context

media.md asks for an S3-compatible storage interface, BullMQ processing with sharp/ffmpeg,
a decoder with no secrets or network, and delivery from a separate CDN origin. Facts on
2026-10-18: no object-storage credentials exist; DNS has only `silvercord.islandmon.cloud`
(no `cdn.` record, no wildcard) and no DNS API credentials are available; Node 24.16's
permission model has no network flag (`node --help` lists fs, child-process, worker,
addons and wasi only), and native addons such as sharp bypass it anyway.

## Decision

1. **Storage.** A `StorageDriver` interface (`put`, `read`, `delete`, `exists`) with one local
   filesystem driver. Production mounts a dedicated volume. Object keys are opaque:
   `staging/<upload>/<random>` and `objects/<upload>/<variant>-<sha256>`; nothing derives
   from client filenames, and the driver refuses any resolved path outside its root. An S3
   driver (Garage/OVH) slots in behind the same interface once credentials exist.
2. **Decoder isolation.** The BullMQ worker (orchestrator) owns DB, Valkey and storage. It copies
   one job's input into a shared jobs volume. A separate `media-decoder` container
   (`network_mode: none`, read-only rootfs, no env secrets, CPU/RAM/PID limits, only the jobs
   volume mounted) runs a supervisor that spawns one decode child per job with an empty
   environment, a 30 s SIGKILL timeout and Node's fs permission model limited to that job
   directory. Results come back as files; the orchestrator validates them before storing.
   Development and tests run the same child locally (`MEDIA_DECODER=local`), which keeps the
   timeout and empty environment but not the network boundary.
3. **Delivery.** Until a separate hostname exists, `GET /media/:upload/:variant/:hash` is served
   by the API on the main origin, authorizing every request (bearer session, current channel
   membership, live attachment, viewer's blocks) with `nosniff`, `default-src 'none';
   sandbox`, `private, no-store`, fixed MIME and attachment disposition for downloads. The
   desktop fetches bytes with its token and renders account-scoped blob URLs. Moving to
   `cdn.<domain>` is a configuration change (`MEDIA_ORIGIN`) plus a Caddy site; it needs a DNS
   record from the owner. Until then acceptance item "no private bytes from the API host" in
   media.md is not met and is tracked in PLAN.md.

## Consequences

- No new external service or credential is required to ship uploads.
- Local-volume media is not covered by the Postgres-only backup; the backup job copies the
  media volume (rsync to the backup directory) so restores keep attachments.
- If a decoder RCE occurs it lands in a container with no network, no secrets and only the
  jobs volume; the orchestrator treats every result file as hostile input (size, MIME and
  dimensions re-checked).
