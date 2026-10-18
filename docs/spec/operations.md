# Spec: isolated VPS operations foundation

Phase 2 deployment foundation for Ubuntu 24.04, 8 vCPU/24 GB at 145.239.79.30.
Host Caddy already serves `play.islandmon.cloud`; SilverCord adds the approved
`silvercord.islandmon.cloud` site only after DNS resolves. REST and gateway share
that HTTPS origin; future media/LiveKit origins remain separate (BRIEF §9).

## Boundaries and configuration

`infra/docker-compose.prod.yml` owns only the `silvercord-prod` project/network/
volumes. It never stops unrelated containers/services or publishes DB/Valkey.
Only API `127.0.0.1:14000` and optional private Mailpit `127.0.0.1:18025` bind to
the host. Native Caddy owns public 80/443 and proxies websocket upgrades normally.
It overwrites forwarded client/protocol headers; API trusts exactly one hop.
Do not replace the existing Caddyfile: add/import the supplied site snippet,
validate the complete existing config, then reload it through its service.

The server image uses a Docker Hub digest-pinned Node 24 Debian slim base,
pnpm 11.26.0, frozen production dependencies and only selected source files.
The Dockerfile-specific allowlist excludes `.env`, Git, desktop files and local
node_modules. Workspace protocol TS source stays outside node_modules because
Node's built-in type stripping refuses dependencies under that directory.
Runtime is nonroot with read-only filesystem, dropped capabilities, no privilege
escalation, bounded tmpfs/PIDs/CPU/RAM and rotated Docker logs. DB/cache use
isolated volumes and health checks; Valkey uses AOF with noeviction so memory
pressure fails requests instead of silently forgetting revocations/rate limits.

Generate distinct random admin/application DB passwords and JWT secret using
`openssl rand -hex 32`, and TOTP key using `openssl rand -base64 32`. Copy the
nonsecret template to `/etc/silvercord/production.env` outside Git and chmod 600.
DB passwords are hex so database URLs need no escaping. The API receives only
its own DB credentials, not the administrator password. An explicit db-init
one-off creates a non-superuser application role owning only its database.
Migrations run with that role. Initialization never silently rotates an existing
role password; coordinate credential rotation separately. Keep JWT/TOTP keys unchanged between releases;
losing the TOTP key makes stored factors/recovery hashes unusable.

SMTP remains unconfigured until real provider credentials/sender authorization
are supplied. For private staging only, explicitly set `COMPOSE_PROFILES=staging`
and `SMTP_URL=smtp://mailpit:1025`; Mailpit does not deliver mail. Its private UI
is reachable through an SSH tunnel to port 18025 and is never routed in Caddy.
Messages are temporary/bounded; no registration or recovery delivery claim is
made while this profile is in use. Fresh-instance first-registration ownership
must be bootstrapped privately before exposing registration publicly.

## Deploy and recovery

Update a clean checkout to a reviewed commit explicitly; `deploy.sh ENV BACKUP_DIR`
builds a SHA-tagged image, waits for DB/cache, writes a checked pre-migration
backup, initializes the application role, applies forward migrations, replaces
the API and waits for health, then points the local `silvercord-api:current` tag
at the successful image for later manual Compose commands. One file lock
serializes deployments and standalone backups per environment file, including the
complete migration/replacement sequence. A failed
API health check restores the previous image, never silently restores/drops the
database. Migrations must be compatible with the prior image; incompatible
migrations need a separate planned maintenance/cutover. Single API replacement
has a brief reconnect window; no zero-downtime guarantee is made. The current
`/health` proves process readiness, not durable dependency health; deployment
also checks DB/cache service health and migration success.

`backup.sh ENV /absolute/new-name.dump` creates a private, consistent Postgres
custom archive, validates its catalog and writes SHA-256 beside it. It refuses
an existing target, publishes only after pg_dump succeeds, and never prints
credentials. Schedule daily at 03:15 UTC using the host's scheduler, with a unique
UTC filename and failure logs. Store under `/var/backups/silvercord` (mode 700),
separate from container volumes. No automatic deletion is built into the script.
An encrypted off-host restic destination, retention and restore schedule must be
configured before calling backups disaster recovery. Local dumps alone do not
survive host loss. Back up the private env/key file encrypted separately.

The paired media archive and database dump must describe the same snapshot. Drain
and stop only the running API/worker services before either archive begins, then
restart those same services on success, failure or interruption. This introduces a
short reconnect window. Decoder jobs cannot modify the private media volume.
Never start an API/worker that was already stopped. The inherited operations lock
allows deploy to call backup without deadlock and excludes a concurrent scheduler.

`restore.sh ENV /absolute/backup.dump silvercord_restore_NAME` verifies checksum
and archive, refuses an existing or production target, creates a fresh isolated
database and restores in one transaction. It never drops a database, removes a
volume, changes API configuration or restarts production. A failed restore leaves
the named diagnostic database for review. Only operator-generated trusted dumps
may be restored. Verify schema, account/session counts and a representative
read, then separately approve any real production cutover. Phase 2 media will
extend backups with consistent private object inventory/copies before uploads
can be declared recoverable. Valkey gateway/presence state is intentionally
ephemeral; Postgres and TOTP/JWT key backups are the recovery authority.

## Acceptance and references

1. Compose config validates without printing secrets; image builds and imports
   protocol/Argon2 under Node as nonroot; migration command is available.
2. Isolated deployment boots with generated keys; no published DB/cache/SMTP,
   only loopback API/UI; existing IslandMon HTTP routes remain unchanged.
3. HTTP and gateway work over TLS after DNS; invalid JWTs and dev secrets fail;
   no public Mailpit route, admin DB credential or secret-bearing image layer.
4. Backup produces a readable archive/checksum; tampered input and existing/live
   restore targets fail; restore drill compares representative records in the
   isolated target. Failed API rollout returns to prior image; no DB deletion.
5. Real SMTP, off-host encrypted storage and scheduling are verified separately;
   those items cannot be inferred from a successful container health check.

Verified 2026-10-18 against [pnpm Docker guidance](https://pnpm.io/docker),
[portable deploy behavior](https://pnpm.io/cli/deploy),
[Compose startup readiness](https://docs.docker.com/compose/how-tos/startup-order/),
[Caddy reverse proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy),
[Postgres dump](https://www.postgresql.org/docs/18/app-pgdump.html) and
[restore](https://www.postgresql.org/docs/18/app-pgrestore.html).
Base/service manifest digests were read from the official Docker Hub APIs.

Validation on 2026-10-18: remote Docker build `silvercord-api:operations-check`
succeeded; a read-only/network-none container imported protocol, app and migration
modules and hashed Argon2 as UID 1000 on Node v24.22.0. Compose config, Bash syntax
and Caddy formatting/adaptation passed. Production startup, role initialization,
backup/restore data checks, scheduling and rollback still require the isolated
deployment acceptance run; these syntax/image checks do not establish those.
