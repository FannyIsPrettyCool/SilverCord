# ADR-0005: HTTP layer conventions

- Status: accepted
- Date: 2026-10-17

## Context

BRIEF §3 names `zod-to-openapi` for OpenAPI generation and §8.1 requires rate limits on
every route. Fastify needs a validator/serializer for Zod schemas regardless.

## Decisions

1. **OpenAPI from `fastify-type-provider-zod` + `@fastify/swagger`** instead of
   `@asteasolutions/zod-to-openapi`. The type provider already turns each route's Zod
   schemas into JSON Schema for validation; `jsonSchemaTransform` feeds the same output to
   Swagger. Using zod-to-openapi too would mean registering every schema twice. The
   contract still lives only in `packages/protocol` Zod schemas, which is the brief's intent.
2. **Responses are validated** by the serializer compiler; a response that violates its
   schema is logged and returned as `INTERNAL`, never sent malformed.
3. **Error envelope** (`packages/protocol/src/errors.ts`) for every non-2xx response;
   services throw `AppError(code, message)`. Messages are client-safe by construction.
4. **Rate limits are declared per route** in `config.rateLimit` (array of rules). Route
   registration throws when the declaration is missing; `[]` is an explicit opt-out
   reserved for health checks. A global per-IP bucket always applies first.
5. **Fail closed:** if Valkey is unreachable, rate-limited requests error instead of
   passing unthrottled.

## Consequences

- Swagger output depends on the type provider's JSON Schema conversion; check
  `/api/v1/openapi.json` when upgrading either package.
- A Valkey outage takes the API down. Acceptable for a single-VPS deployment where Valkey
  runs next to the API; revisit if Valkey moves off-box.
