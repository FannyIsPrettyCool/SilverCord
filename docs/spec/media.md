# Spec: private message media

Phase 2; BRIEF §5.6 and §8.3. Files belong to a channel from reservation onward.
Use the fixed S3-compatible storage interface (local filesystem in development),
BullMQ workers, sharp and ffmpeg; verify/pin dependencies before implementation.

## Model and limits

- `media_uploads`: snowflake `id` PK, user FK `owner_id`, channel FK `channel_id`,
  sanitized display `filename` (1–128 characters), declared `size_bytes`,
  `received_bytes`, `state` (`uploading|processing|ready|attached|failed|deleting`),
  opaque `staging_key`, detected MIME, `version`, `created_at`, `expires_at`,
  nullable safe failure code. Index `(owner_id,state)`, channel_id, and
  `(state,expires_at)` for cleanup; object keys never derive from filenames.
- `media_variants`: PK `(upload_id,variant)` with upload FK CASCADE,
  storage key, SHA-256 hash, bytes, MIME, nullable width/height/duration/blurhash.
  Variants are `display`, `thumbnail`, `download`; no unprocessed image original
  is served. Size/hash match actual output, never client input.
- `message_attachments`: PK `(message_id,upload_id)`, both FKs CASCADE,
  UNIQUE upload_id (one attachment belongs to one message), position 0–9. Index
  upload_id is provided by the unique constraint. Services validate same channel.
- `media_quota_usage`: PK `scope` (`instance` or `user:<snowflake>`), nonnegative
  reserved/stored bytes. Reserve atomically before receiving data; quota locks
  take instance first, then users ascending, after any channel/message/upload
  locks. Reconciliation repairs counters from upload/variant rows, not filesystem
  guesses. Removing an account/message schedules private objects for deletion.
- Defaults in validated env: 25 MiB/file, chunks ≤4 MiB, 10 files/message,
  3 concurrent uploads/user, 512 MiB/user, 20 GiB/instance, 1-hour reservation TTL.
  Count staged bytes, derived files and attached files against quotas. Reserve
  source size plus up to twice that for variants; processing fails safely if the
  bound is exceeded. Bound total staging disk usage separately in Compose.

## REST and lifecycle

Prefix `/api/v1`; every route declares `auth: 'user'`, explicit Zod params,
headers/query/JSON schemas and response/error schemas, plus rate rules. Binary
routes validate the bounded stream rather than inventing a JSON body schema;
the route-coverage suite must exercise their binary validation explicitly.
All lookup/access failures, including foreign upload ids, use 404.
Policies below are per-user token buckets capacity/refillPerSecond; global IP
limiting applies and Valkey failures fail closed.

| Method/path | Contract | Bucket |
|---|---|---|
| POST `/channels/:channelId/uploads` | `{filename,sizeBytes}` → `{id,chunkBytes,offset:0,expiresAt}`; requires current send permission | upload.create 5/(5/60) |
| PUT `/uploads/:uploadId/chunks` | octet-stream, required exact integer `Upload-Offset` and bounded Content-Length; → `{offset}` | upload.chunk 20/2 |
| GET `/uploads/:uploadId` | owner only → state, committed offset, safe variant metadata | upload.read 60/2 |
| POST `/uploads/:uploadId/complete` | empty JSON → current state (200); idempotent | upload.write 10/1 |
| DELETE `/uploads/:uploadId` | owner, unattached only → 204, cleanup idempotent | upload.write 10/1 |
| GET `/attachments/:uploadId` | current channel member, attached visible message → variant metadata/paths | upload.read 60/2 |

Headers are added explicitly to CORS (Upload-Offset and Content-Length as
needed), with only configured app/CDN origins. Renderer sends bytes directly
with its access token; refresh tokens remain in main. Reservation and complete
check current channel send permission. Every chunk checks owner, membership,
state, expiry, remaining length and offset; no open-ended unknown-size body.
Write a random temporary chunk outside web roots, cap bytes while streaming,
then advance offset atomically only after storage succeeds. Same committed
offset/body-hash retry returns the saved offset, a different body returns 409;
parallel chunks with the same offset commit once. Disconnect deletes incomplete
temp chunks. Store bounded chunk hashes/lengths in `media_upload_chunks` (PK
upload_id,offset, upload FK CASCADE) to implement resume without trusting a client
checksum. Restart reports only durable committed bytes.

Complete verifies exact total length, transitions once and enqueues job id
`media:<uploadId>`; DB state is authoritative, so a reconciler re-enqueues
processing rows after DB/queue failure. Worker writes immutable variants before
marking ready and deletes staging data; retry checks row state/version first.
Attaching ready uploads happens in the message transaction: same owner/channel,
not expired, no previous attachment, current send authorization. Failed or
processing uploads cannot be attached. Idempotent message retry cannot consume
them twice. Worker completion/cleanup never revives a deleted or attached row.
Hourly sweep deletes expired unattached reservations; tombstoned deleting rows
remain until idempotent object removal and quota release succeed.

## Processing threat model and private delivery

Treat every byte, name, MIME and codec header as hostile. Sniff file signatures
and parse allowed formats; a mismatch is rejected. Initial inline formats:
JPEG, PNG/APNG, WebP and GIF; MP4/WebM get bounded ffmpeg metadata/poster handling.
Other files are download-only `application/octet-stream`; reject SVG, HTML,
XML, executable formats and archives rather than parsing/unpacking them. Never
run a shell on filenames, follow symlinks, accept remote URLs or let processors
open the network. A local driver verifies canonical resolved paths stay beneath
its configured root; production bucket and staging objects are private.

For images auto-orient, decode/re-encode, remove EXIF/GPS/XMP, create ≤480px
thumbnail, ≤2560px display and blurhash. Preserve frame timing/loops for animated
GIF/WebP/APNG within limits; GIF/WebP use explicit animated decoding, APNG uses
bounded ffmpeg decoding followed by sanitized animated WebP output if sharp's
installed decoder cannot preserve it. Never silently flatten animation.
Limit dimensions to 8192 per axis, 40 million pixels/frame, 100 frames and
100 million decoded pixels total; bound decoded output before allocation.
Reject malformed/truncated data; do not disable sharp safety limits. Decoder
sandbox has no application secrets/network, bounded CPU/RAM/temp storage,
one processing job at a time and 30 s wall timeout enforced outside the decoder.
The job orchestrator alone has scoped Valkey/storage access; do not pass those
credentials or network access into the decoder process.
Video probing/thumbnailing has the same process/network/time limits. Optional
ClamAV profile scans before ready; scan errors fail closed when enabled.

CDN GET/HEAD uses `/media/:uploadId/:variant/:hash` on the configured separate
origin. Caddy authorizes every request with the bearer token through an internal
API access check (not an anonymously accessible bypass); verify current session,
channel membership, live message attachment and block visibility. CDN cannot
list storage or expose staging. Access token is never in a URL; desktop fetches
authorized bytes and renders account-scoped blob URLs, revoking them on eviction
or logout. Downloads go through the existing validated desktop bridge. Do not
reuse a generic external URL opener as a filesystem writer.
`nosniff`, restrictive `default-src 'none'; sandbox` CSP, safe Content-Disposition
attachment for downloads, fixed sniffed MIME for inline variants, exact CORS
origin and `private, no-store` are required. Immutable object-cache reuse stays
inside private infrastructure (ADR-0008); no public capability URLs or buckets.

## Events, acceptance and verified references

`MEDIA_CHANGED {uploadId}` is a transient content-free owner invalidation;
reservation polling reconciles missed worker events. Attached content changes
use message invalidations. Do not log filenames, upload bodies or bearer tokens.

1. Real storage/DB/Valkey tests cover upload, interrupted/chunk retry, complete,
   worker retry, attachment retry, expiry, quota contention and cleanup restart.
2. Oversize/chunk overflow, MIME spoof, SVG/polyglot, decompression bomb, path
   traversal, animation bomb, revoked membership and foreign attachment ids fail.
3. Sanitized fixtures lose GPS/EXIF and retain animation frame timing; approved
   videos have safe poster/dimensions; unsupported files never render inline.
4. Direct storage/CDN URLs, cached credentials and another user's upload cannot
   bypass membership; removal/block is effective on the next fetch. No private
   file bytes originate from the API host. Paste/drop progress, cancel/retry,
   EN/FR errors and accessible labels work in the real Electron app.

Checked 2026-10-18: [sharp constructor limits and animation](https://sharp.pixelplumbing.com/api-constructor/),
[metadata removal](https://sharp.pixelplumbing.com/api-output/),
[ffmpeg format support](https://ffmpeg.org/ffmpeg-formats.html), and
[Fastify streaming parsers](https://fastify.dev/docs/latest/Reference/ContentTypeParser/).
Actual installed codecs and safety flags require fixture tests before shipping.
