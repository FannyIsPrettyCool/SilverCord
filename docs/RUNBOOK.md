# Runbook

Operator guide for a single person running SilverCord on one VPS. Sections are
filled in as the corresponding phase lands; empty sections are marked pending.

## Local development

```sh
pnpm i                 # install (Node 24 LTS, pnpm 11.26)
pnpm dev:stack         # Postgres, Valkey, LiveKit (dev), Mailpit via Docker Compose
pnpm dev               # server + Electron client
pnpm dev:stack:down    # stop the stack (data volumes are kept)
```

Dev endpoints:

| Service | URL |
|---|---|
| API | http://localhost:4000 (health: `/health`) |
| Postgres | `postgres://silvercord:silvercord@localhost:5432/silvercord` |
| Valkey | `redis://localhost:6379` |
| LiveKit (dev mode) | ws://localhost:7880 (key `devkey`, secret `secret`) |
| Mailpit UI | http://localhost:8025 (SMTP on 1025) |

## VPS setup

Production: `https://silvercord.islandmon.cloud` on the shared OVH VPS `145.239.79.30`
(Ubuntu 24.04), next to IslandMon. Design and boundaries: `docs/spec/operations.md`.

- SSH: `ssh -i ~/.ssh/islandmon_ovh ubuntu@145.239.79.30` (key only, passwordless sudo).
- Checkout: `/srv/silvercord` (owned by `ubuntu`, clean clone of `main`).
- Secrets: `/etc/silvercord/production.env` (root, 600). Owner bootstrap credentials:
  `/etc/silvercord/owner.json` (account `fanny`, instance admin). Read with `sudo cat`.
- Host Caddy owns 80/443: `/etc/caddy/Caddyfile` ends with
  `import /etc/caddy/silvercord.caddy` (copy of `infra/caddy/silvercord.caddy`).
  Always `caddy validate` before `systemctl reload caddy`; backups sit beside it.
- Compose project `silvercord-prod`; only the API binds `127.0.0.1:14000` and private
  Mailpit `127.0.0.1:18025` (SSH tunnel only). UFW allows 22, 80, 443 plus IslandMon ports.
- Registration is invite-only; create invites from the owner account, or from the host
  without signing in (`count maxUses hours`, codes printed once):
  `sudo docker compose --env-file /etc/silvercord/production.env -f infra/docker-compose.prod.yml
  run --rm --no-deps api node src/modules/admin/invite-cli.ts 5 1 336`
- SMTP is not configured: the `staging` profile routes mail to private Mailpit, so
  verification and reset mails are not delivered. Set `SMTP_URL`, `MAIL_FROM` and an empty
  `COMPOSE_PROFILES` in the env file, then redeploy, once a provider is available.

## Deploy

### Public homepage and installer

The public root and `/fr/` are static pages. API, gateway and health paths still
reach the backend; private media stays on its separate CDN. `apps/site` contains
only build-time translations, HTML/CSS and shared brand assets. Build with
`pnpm --filter @silvercord/site build`; output is `apps/site/dist` (ignored by Git).

Caddy reads `/srv/silvercord-site/current`, an atomic symlink to an immutable
`/srv/silvercord-site/releases/<commit>` directory. Public downloads are stored
separately in `/srv/silvercord-downloads`; neither directory contains secrets.
Upload a new complete site release, then atomically switch `current`. Validate
the full Caddyfile before reloading; keep the previous release for rollback.

Windows artifact: build the verified desktop output with
`pnpm --filter @silvercord/desktop exec electron-builder --config electron-builder.config.ts --win nsis --x64 --publish never`.
Publish `apps/desktop/release/SilverCord Setup <version>.exe` as
`SilverCord-<version>-windows-x64.exe`. Compare local/server SHA-256 before exposing
it, and publish its matching `SHA256SUMS.txt`. Never replace a versioned artifact
with different bytes. Check public GET/HEAD and download size after publication.
The homepage version follows the desktop package version: publish its matching
installer before switching the page. Automatic updates/Linux builds remain Phase 7.

### API deployment

```sh
cd /srv/silvercord && git pull --ff-only
sudo bash infra/scripts/deploy.sh /etc/silvercord/production.env /var/backups/silvercord
curl -fsS https://silvercord.islandmon.cloud/health
```

The script refuses a dirty checkout, takes a checked backup, migrates as the
application role, replaces the API and restores the previous image if health fails.

## Backups

`silvercord-backup.timer` (from `infra/systemd/`) runs `backup.sh` daily at 03:15 UTC
into `/var/backups/silvercord/nightly-<UTC>.dump` with a `.sha256`. Logs:
`journalctl -u silvercord-backup.service`. No off-host copy yet: dumps do not survive
loss of the VPS until a restic target is configured (needs storage credentials).

Database and media archives are taken while the running API and worker are drained
and stopped. Clients reconnect after those same services restart. A per-environment
operations lock excludes deployments and overlapping backups. Failures restart the
previously running services; already stopped services remain stopped.

## Staging (loopback only)

A second copy of the stack runs on the VPS for UI work and live tests, never routed by Caddy:
checkout `/srv/silvercord-staging` (any branch), env `/etc/silvercord/staging.env`
(`COMPOSE_PROJECT_NAME=silvercord-staging`, `API_PORT=14100`, `MAILPIT_PORT=18125`,
`CORS_ORIGINS=app://bundle,http://localhost:5173`), backups in `/var/backups/silvercord-staging`.

```sh
cd /srv/silvercord-staging && git checkout <branch> && git pull --ff-only
sudo bash infra/scripts/deploy.sh /etc/silvercord/staging.env /var/backups/silvercord-staging
sudo env SILVERCORD_IMAGE=silvercord-api:silvercord-staging-current docker compose \
  --env-file /etc/silvercord/staging.env -f infra/docker-compose.prod.yml \
  run --rm --no-deps -e NODE_ENV=development -e SEED_PERF_MESSAGES=10000 api node src/db/seed-cli.ts
```

From the workstation: `ssh -N -L 127.0.0.1:4000:127.0.0.1:14100 -i ~/.ssh/islandmon_ovh
ubuntu@145.239.79.30`, then `pnpm ui:shots` or the live Playwright config use localhost:4000.
Stop it with `docker compose ... down` (keeps volumes) when not needed.

Cross-machine acceptance: from Windows Git Bash, run
`bash tools/scripts/cross-machine-acceptance.sh`. It starts one real Windows Electron
and a disposable Linux Electron/Xvfb container against private staging (dedicated tunnel
on port 14400), records only event names and screenshots, then removes the test container,
remote checkout and tunnel. Evidence stays under `.artifacts/cross-machine/`; the test
image and dependency cache remain reusable. It requires the development seed accounts,
never production accounts. This verifies separate machines, not separate home networks.

## Media

Uploads live in the `silvercord-prod_media-storage` volume; the worker copies one job at a time
into `media-jobs`, where the network-less `media-decoder` container processes it (ADR-0009).
`backup.sh` writes `<name>.media.tar` beside each dump; restore media by extracting it into a
fresh volume. Private bytes use `https://cdn.silvercord.islandmon.cloud/media/...`;
the API host rejects media paths and the CDN rejects other API paths. Both DNS A
records point to `145.239.79.30`; Caddy handles TLS and the server authorizes every
media fetch. Tokens remain headers, never URL parameters. Owner-instance desktop
builds select this origin automatically; self-hosters can set `SILVERCORD_MEDIA_URL`.

## Restore drill

```sh
sudo bash infra/scripts/restore.sh /etc/silvercord/production.env \
  /var/backups/silvercord/<file>.dump silvercord_restore_<name>
```

Restores into a new isolated database and never touches production. First drill:
2026-10-18 into `silvercord_restore_drill_20261018` (user and session counts matched).
The phase 8 drill from scratch (fresh host) is still pending.

## Monitoring — pending (phase 8)
## Incident checklist — pending (phase 8)
