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

## VPS setup — pending (phase 2)
## Deploy — pending (phase 2)
## Backups — pending (phase 2)
## Restore drill — pending (phase 8)
## Monitoring — pending (phase 8)
## Incident checklist — pending (phase 8)
