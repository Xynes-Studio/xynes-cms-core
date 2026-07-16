# Xynes CMS Core Developer Guide

## Architecture

The CMS Core service is built using Bun and Hono. It manages content entries, blog posts, and comments.

### Core Components

- **Actions**: Handler functions in `src/actions/` for each CMS operation
- **Routes**: `src/routes/internal-actions.ts` handles incoming action requests
- **Middleware**:
  - `error-handler.ts`: Standardized error envelope responses
- **Schema**: Drizzle ORM schema in `src/infra/db/schema.ts`
  - `cms.content_types.route_segment` (`routeSegment` in APIs) is required and unique per workspace for generic routing.

## Development

### Global Standards

- **Folder Structure**: Feature-based separation in `src/`
- **Testing**: TDD mandatory. 75%+ coverage. See `docs/adr/001-testing-strategy.md`
- **Linting**: Run `bun run lint` before commits
- **Security**: Validate inputs (prefer `z.strict()`), scope all queries by `workspaceId`, and avoid unsafe object merges
- **Public Pagination**: For public list actions, clamp `limit` to a sane maximum (currently `100`). Use `src/actions/pagination.ts` and ensure repositories only receive validated/clamped values (never raw request payload).

### Setup

```bash
bun install
bun run dev
```

### Testing

```bash
bun run test                # All tests (loads env file)
bun test test/unit          # Unit tests only (no env-file needed)
bun run test:coverage       # With coverage
```

### Local DB for Integration Tests

Integration/feature tests require Postgres. For a reproducible local setup, use `docker-compose.test.yml` and follow `docs/DEVELOPMENT.md`.

### Environment

- Scripts load `.env.dev` by default (Docker/dev). Override for host runs:
  - `XYNES_ENV_FILE=.env.localhost bun run dev`
  - `XYNES_ENV_FILE=.env.localhost bun run test`

### CMS Actions

- Internal endpoint: `POST /internal/cms-actions` (requires `X-Workspace-Id`)
- Admin listing action key: `cms.blog_entry.listAdmin` (see `docs/CMS_ACTIONS.md` for payload/response)
- Frontend template-driven read/list: `cms.content.listPublished` + `cms.content.getPublishedBySlug` (see `docs/CMS_ACTIONS.md`)
- Directory-first entry management actions:
  - `cms.entry.create`
  - `cms.entry.update`
  - `cms.entry.delete` (soft delete)
  - `cms.entry.publish`
  - `cms.entry.listByDirectory`
  - `cms.entry.getById`
  - `cms.entry.collaborators.set`
  - `cms.entry.favorite.toggle`
  - `cms.entry.favorite.list`
  - `cms.entry.share.generateInternalLink`
- Workspace directory tree persistence:
  - `cms.content_directories.listForWorkspace`
  - `cms.content_directories.create`
  - `cms.content_directories.update`
  - `cms.content_directories.delete`

### Content Directory Action Standards (Bun + Hono + Drizzle)

- Action ownership:
  - Handler logic: `src/actions/handlers/content-directories.handler.ts`
  - DB access: `src/infra/db/repositories/content-directory.repository.ts`
  - Schema source of truth: `src/infra/db/schema.ts` + generated migration under `drizzle/`
- Security and workspace isolation:
  - Validate create payloads strictly (`z.strict()`).
  - Enforce workspace-scoped parent validation for both custom-directory and content-type parents.
  - Reject route-derived ephemeral parent IDs (for example `content-path-*`) for persistence.
  - Prevent root segment collisions with content-type `routeSegment`.
  - For destructive operations, perform workspace-scoped subtree deletion in the DB (`WITH RECURSIVE`) to avoid stale in-memory descendant lists and orphan records under concurrent writes.
  - Enforce DB-level uniqueness for both root and nested directories:
    - root: unique `(workspace_id, path_segment)` where `parent_id IS NULL`
    - nested: unique `(workspace_id, parent_id, path_segment)` where `parent_id IS NOT NULL`
- Tech-debt controls:
  - Keep transform/validation logic in handlers, persistence logic in repositories.
  - Reuse existing content-type repository helpers rather than duplicating workspace checks.
  - Preserve idempotent/append-only migration workflow (new migration files only).

### Entry Management Action Standards (Directory-First CMS)

- Action ownership:
  - handler logic: `src/actions/handlers/entry-management.handler.ts`
  - persistence logic: `src/infra/db/repositories/content-entry.repository.ts`
  - schema/migrations: `src/infra/db/schema.ts` + `drizzle/`
- Security + integrity requirements:
  - All entry reads/writes are workspace-scoped (`workspace_id` required in every query).
  - Entry actor metadata is first-class: `cms.content_entries.created_by` and `updated_by` are populated from `ActionContext.userId` for new create/update/status flows. Historical rows may remain `NULL` when the actor cannot be proven; do not backfill from workspace owner unless there is direct evidence.
  - Soft delete only (`deleted_at`, `deleted_by`); deleted entries must not appear in active reads.
  - `directory_id` references `cms.content_directories(id)` with `ON DELETE SET NULL` to prevent orphan references.
  - Use strict payload validation (`z.strict()` + explicit enums/defaults), never trust client sort/filter input.
  - Share action returns internal authenticated edit URL only, never public bypass links.
- Maintainability rules:
  - Keep mapper/merge logic in handlers and SQL behavior in repositories.
  - Reuse common repository helpers instead of duplicating workspace filters.
  - Add unit tests for each new action key and repository helper when extending contract.

### Actor Surface (CMS-API-KEY-ACTOR-1, Story A)

The internal endpoint recognises the actor headers emitted by `xynes-gateway`
after the Workspace Admin API-key enforcement work (gateway Tasks 4 + 5).
This mirrors the contract already shipped by `xynes-accounts-service` (PFU-1).

Headers consumed by `extractContext` in `src/routes/internal-actions.ts`:

| Header                 | Required when               | Validation                           |
| ---------------------- | --------------------------- | ------------------------------------ |
| `X-Workspace-Id`       | always (workspace-scoped)   | non-empty string                     |
| `X-XS-Actor-Type`      | optional (defaults to `user`) | one of `user`, `api_key`           |
| `X-XS-API-Key-Id`      | `actor=api_key`             | UUID                                 |
| `X-XS-API-Key-Prefix`  | `actor=api_key`             | exactly 8 lowercase hex chars        |
| `X-XS-User-Id`         | `actor=user` (optional)     | trimmed string; whitespace-only = absent |

`ActionContext` (in `src/actions/types.ts`) carries the resolved actor as
the optional discriminated union `actor: ActionActor = UserActor | ApiKeyActor`:

```ts
type UserActor   = { kind: "user";    userId: string };
type ApiKeyActor = { kind: "api_key"; apiKeyId: string; keyPrefix: string };
```

Important rules:

1. **Raw API key never appears.** Only the public `apiKeyId` (UUID) and the
   8-char `keyPrefix` are carried — never the `xynes_live_<hex>` raw key.
   This matches the gateway's redaction posture (gateway Task 6).
2. **api_key actor → `ctx.userId` is `undefined`.** API-key callers have no
   human identity. Any `X-XS-User-Id` header sent alongside an api_key
   actor is deliberately ignored (defense-in-depth).
3. **No `X-XS-Actor-Type` ⇒ `user` actor.** Pre-existing callers that only
   send `X-XS-User-Id` continue to work byte-for-byte (legacy `ctx.userId`
   is also populated for handlers that have not migrated to `ctx.actor`).
4. **Anonymous public routes still work.** When `X-XS-User-Id` is absent and
   the actor type is `user` (or unset), `ctx.actor` is `undefined` —
   handlers like `cms.comments.create` may opt into anonymous access.
5. **Malformed actor headers ⇒ 400 `INVALID_HEADER`** before any handler
   runs. The error envelope shape is the standard `{ ok: false, error: {
   code, message }, meta: { requestId } }`.

Stories B (authz short-circuit on `api_key`) and C (per-handler audit
policy) are tracked in
`xynes/xynes-infra/docs/plans/2026-05-10-cms-core-api-key-actor-recognition.md`
and are **out of scope** for Story A.

### Actor-aware Authz Middleware (CMS-API-KEY-ACTOR-1, Story B)

`src/middleware/authz-check.ts` `checkActionPermission` is **actor-aware**.

When `ctx.actor?.kind === "api_key"` the middleware **SHORT-CIRCUITS** and
returns without invoking `authzClient.check`. Rationale:

1. The gateway has already enforced that the resolved API key's scope set
   contains the route's `actionKey` (see
   `xynes-gateway/src/router/dynamicRouter.ts` Task 4). A scope miss never
   reaches cms-core — the gateway returns `403 FORBIDDEN_SCOPE_MISS`.
2. The gateway has already enforced workspace ownership (`apiKey.workspaceId
   === route.workspaceId`). A workspace mismatch never reaches cms-core
   either — the gateway returns `403`.
3. The api_key actor carries **no `identity.users` row** to check against,
   so any user-based authz call would be a layering violation.

This mirrors `xynes-accounts-service/src/actions/guards.ts` `requirePermission`
introduced under PFU-1.

#### What Story B does NOT do

- **Does not** allow an api_key actor to perform an action whose scope is
  not in its preset — the gateway has already blocked that.
- **Does not** change `authz-check.ts` behaviour for user actors —
  `mockAuthzClient.check` is still called with `{ userId, workspaceId,
  actionKey }` exactly as before. Missing-`userId` writes still throw
  `UnauthorizedError("User authentication required for this action")`.
- **Does not** populate `created_by` / `updated_by` audit columns for
  api_key callers — that is the responsibility of the handlers and is
  covered by Story C (per-handler audit policy + `requireUserActor`
  guard for out-of-preset actions).

#### Backwards compatibility

| Caller shape                                  | Behaviour                                  |
| --------------------------------------------- | ------------------------------------------ |
| `{ userId, actor: { kind: "user", userId } }` | calls authz with `userId` (unchanged)      |
| `{ userId }` (no `actor`)                     | calls authz with `userId` (legacy path)    |
| `{ actor: { kind: "api_key", ... } }`         | **NEW**: short-circuits, no authz call     |
| `{}` (no actor, no userId)                    | write → 401; read with `requireUserId=false` → skips authz |

#### Tests

- `test/unit/middleware/authz-check.test.ts` — pre-existing 32 tests for
  the user-actor path. Unchanged.
- `test/unit/middleware/authz-check-actor.test.ts` (NEW, 15 tests):
  - api_key short-circuit on write actions (`cms.entry.create`, `.update`,
    `.publish`, `.status.set`).
  - api_key short-circuit on read actions (`cms.entry.listByDirectory`,
    `.getById`).
  - api_key short-circuit when `ctx.userId` is missing (no `UnauthorizedError`).
  - api_key short-circuit when `requireUserId=true` is forced.
  - api_key actor ignores a stray `ctx.userId`.
  - User-actor regression guard: missing `userId` → `UnauthorizedError`.
  - User-actor happy path: authz called with the expected payload.
  - User-actor denied: throws `ForbiddenError` without leaking action key.
  - Anonymous public-route path unchanged.
  - Legacy (`userId` only, no `actor`) write path unchanged.

### Per-handler Audit Policy & Out-of-preset Guard (CMS-API-KEY-ACTOR-1, Story C)

`src/middleware/actor-guards.ts` exports the handler-level surface for the
actor-aware contract. Three helpers cover all use cases:

| Helper                  | Returns / throws                                                                                                                                                  | Use for                                                                                                  |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `requireUserActor(ctx)` | Returns `userId: string` for user actors. Throws `ForbiddenActorKindError` (403 `FORBIDDEN_ACTOR_KIND`) for api_key actors; throws `UnauthorizedError` (401) when no actor and no legacy `userId`. | Handlers that MUST have a human user identity — out-of-preset actions, FK-required audit columns.        |
| `getOptionalUserId(ctx)` | Returns `string` (user actor or legacy `ctx.userId`) or `null` (api_key actor, anonymous).                                                                       | In-preset write handlers that populate nullable audit columns (`created_by`, `updated_by`).              |
| `isApiKeyActor(ctx)`    | Returns `boolean`. Reads `ctx.actor.kind` only; does NOT fall back to `ctx.userId`.                                                                              | Defensive branching when a handler wants to alter behaviour for api_key callers without nulling columns. |

#### In-preset handler policy (`cms_authoring` + `cms_publisher`)

| Action key                  | Audit columns touched               | api_key behaviour                                                                                       |
| --------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `cms.entry.create`          | `created_by`, `updated_by`          | Allowed. Both columns written as `NULL` via `getOptionalUserId(ctx)`.                                   |
| `cms.entry.update`          | `updated_by`                        | Allowed. `updated_by` is **explicitly** written as `NULL` (not omitted) so the audit signal is unambiguous. |
| `cms.entry.publish`         | `updated_by`, `published_at`        | Allowed. `updated_by = NULL`, `published_at = now()` (status transition is the explicit intent).        |
| `cms.entry.status.set`      | `updated_by`                        | Allowed. `updated_by = NULL`.                                                                           |
| `cms.entry.getById`         | none                                | Allowed. Favorites are NOT queried (no user identity to scope them on).                                  |
| `cms.entry.listByDirectory` | none                                | Allowed. Same — no favorite query.                                                                       |

Audit attribution for api_key writes is preserved out-of-band via the
gateway telemetry pipeline (Task 5 of the gateway API-key plan emits
`actorType`, `apiKeyId`, `keyPrefix`, `actionKey` on every request). The
nullable column FKs `identity.users` with `ON DELETE SET NULL`, so writing
`NULL` is the honest signal that no human user performed the action; a
synthetic UUID would lie to downstream consumers.

#### Out-of-preset handler guard

The following handlers are NOT in any MVP API key preset. They call
`requireUserActor(ctx)` at the top so an api_key caller is rejected with
`403 FORBIDDEN_ACTOR_KIND` **before** any DB call:

- `cms.entry.delete`
- `cms.entry.collaborators.set`
- `cms.entry.favorite.toggle`
- `cms.entry.favorite.list`
- `cms.entry.share.generateInternalLink`
- `cms.content_directories.listForWorkspace`
- `cms.content_directories.create`
- `cms.content_directories.update`
- `cms.content_directories.delete`

This is defense-in-depth — the gateway scope check already 403s every one
of these for the MVP presets. If a future preset accidentally includes one
of these scopes, the handler still refuses with a stable error code
instead of silently corrupting audit columns or per-user state.

#### What Story C does NOT do

- **Does not** introduce `actor_kind` / `actor_id` columns on
  `cms.content_entries`. Audit attribution for api_key writes lives in the
  gateway telemetry stream (Task 5); a column-level audit redesign is an
  out-of-scope follow-up.
- **Does not** modify any existing schema, migration, or repository. The
  `created_by` / `updated_by` columns are already nullable.
- **Does not** change the user-actor path. Every existing user-actor unit
  test still passes byte-for-byte (the `entry-management.handler.test.ts`
  "soft deletes entry with actor userId" / "updates entry metadata" /
  publish / status.set tests continue to assert `createdBy: ctx.userId`,
  `updatedBy: ctx.userId`, `deletedBy: ctx.userId`).
- **Does not** weaken the missing-auth posture. A handler that previously
  threw `ValidationError` for missing `userId` (the local `requireUserId`
  in `entry-management.handler.ts`) now throws `UnauthorizedError` (401)
  via `requireUserActor` — a stricter, more correct status code for a
  missing-auth case. The single pre-existing test that asserted the old
  shape (`"throws validation error when userId missing for delete"`) was
  updated to assert `UnauthorizedError`.

#### Tests

- `test/unit/middleware/actor-guards.test.ts` (NEW, 17 tests) — direct
  coverage for the three helpers including the api_key-with-stray-userId
  defense-in-depth case, the error-code/status-code contract, and the
  alias `requireUserActorForUserScopedAction`.
- `test/unit/handler-actor-audit.test.ts` (NEW, 17 tests) — Story D
  required cases #12–#19:
  - In-preset api_key audit: `create` → `createdBy = NULL`,
    `update` → `updatedBy = NULL` (explicit, not omitted),
    `publish` / `status.set` → `updatedBy = NULL`,
    `getById` / `listByDirectory` → `listFavoriteEntryIdsByUser` NOT called.
  - User-actor regression for `create` (preserves `createdBy = userId`).
  - Out-of-preset rejection: `delete`, `collaborators.set`,
    `favorite.toggle`, `favorite.list`, `share.generateInternalLink`,
    every `content_directories.*` handler — all throw
    `ForbiddenActorKindError` with code `FORBIDDEN_ACTOR_KIND` (403) and
    NO DB call is made before the guard fires.

## Routes

- `GET /health`: Public, database-backed container health check. Returns HTTP
  `200` when PostgreSQL is reachable and HTTP `503` when the database check
  fails or exceeds one second. The response is intentionally limited to:

  ```json
  {
    "ok": true,
    "service": "xynes-cms-core",
    "version": "dev",
    "uptime_seconds": 42,
    "checks": { "db": "ok" }
  }
  ```

  `version` reads `XYNES_BUILD_VERSION` and falls back to `dev`. Failed probes
  are cached for 30 seconds to avoid a database retry storm. Database errors,
  connection strings, credentials, and stack traces never appear in the body.
- `GET /ready`: Startup/readiness check. Runs the existing Postgres and schema
  checks and returns `{ "status": "ready" }` (or 503 with a sanitized error).

## Production Image (H-4)

The Dockerfile exposes a Compose-compatible `dev` target and a hardened `prod`
target. The production image runs Bun directly against `src/index.ts`, listens on
port `4202`, and runs as the non-root `xynes` user (UID/GID `1001`). It includes
only production dependencies plus the Drizzle migrations required by the runtime
migration runner.

### Build and inspect

```bash
docker buildx build --load --target prod \
  -t xynes-cms-core:h4 .

docker image inspect xynes-cms-core:h4 \
  --format 'user={{.Config.User}} health={{json .Config.Healthcheck.Test}}'

docker run --rm --entrypoint sh xynes-cms-core:h4 -c \
  'find drizzle -maxdepth 2 -type f -print | sort'
```

The final command must list every committed migration and Drizzle metadata file.
Do not add `drizzle/` to `.dockerignore`: `src/infra/db/migrate.ts` resolves the
runtime migration folder as `drizzle`.

### Run against PostgreSQL

Pass secrets through the environment or secret manager; never place a database
URL in the image or command history.

```bash
docker run --rm --name xynes-cms-core-h4 \
  -p 4202:4202 \
  --env-file .env.localhost \
  -e PORT=4202 \
  -e XYNES_BUILD_VERSION=h4-local \
  xynes-cms-core:h4
```

From another terminal:

```bash
curl -fsS http://127.0.0.1:4202/health
docker inspect xynes-cms-core-h4 \
  --format '{{.State.Health.Status}}'
```

Expect HTTP `200`, `checks.db = "ok"`, and Docker health status `healthy`. The
image healthcheck calls `bun run healthcheck`, which uses Bun's built-in `fetch`
against `127.0.0.1:${PORT:-4202}`; curl is not installed in the image.

### Vulnerability scan

```bash
docker run --rm \
  -v /var/run/docker.sock:/var/run/docker.sock \
  aquasec/trivy:0.69.3 image \
  --severity HIGH,CRITICAL \
  --ignore-unfixed=false \
  xynes-cms-core:h4
```

The H-4 scan result and temporary service-specific risk acceptances are recorded
in `CVE-WAIVERS.md`. A release is blocked by an undocumented HIGH or any CRITICAL
finding. Rebuild, rescan, and update or remove the relevant waiver after a base
image or dependency upgrade.

## Standard Response Envelope

All responses use the platform standard envelope:

**Success**:
```json
{ "ok": true, "data": {...}, "meta": { "requestId": "req-..." } }
```

**Error**:
```json
{
  "ok": false,
  "error": { "code": "ERROR_CODE", "message": "...", "details": {...} },
  "meta": { "requestId": "req-..." }
}
```

## Error Codes

| Code | HTTP | Description |
|------|------|-------------|
| `VALIDATION_ERROR` | 400 | Payload validation failed |
| `MISSING_HEADER` | 400 | Required header missing |
| `CONTENT_TYPE_NOT_FOUND` | 404 | Content type doesn't exist |
| `CONTENT_TYPE_ROUTE_SEGMENT_NOT_FOUND` | 404 | No content type for routeSegment |
| `ENTRY_NOT_FOUND` | 404 | Entry not found |
| `UNKNOWN_ACTION` | 404 | Action key not registered |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

## Internal Service Authentication

The CMS Core service uses JWT-based authentication for internal service-to-service calls.

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `INTERNAL_JWT_SIGNING_KEY` | For JWT mode | Shared secret for signing/verifying internal JWTs (min 32 bytes recommended) |
| `INTERNAL_AUTH_MODE` | No | `jwt` (strict) or `hybrid` (default, allows legacy tokens) |
| `INTERNAL_SERVICE_TOKEN` | For hybrid mode | Legacy static token for backwards compatibility |

### Authentication Modes

- **`jwt`**: Requires valid JWT tokens only. Use in production.
- **`hybrid`** (default): Accepts both JWT and legacy static tokens. Use during migration.

### JWT Payload Structure

```typescript
{
  aud: ServiceKey;      // Target service ('cms-service')
  iss?: ServiceKey;     // Optional: Issuing service ('gateway-service')
  iat: number;          // Issued at (epoch seconds)
  exp: number;          // Expiration (epoch seconds)
  internal: true;       // Internal marker
  requestId: string;    // Request correlation ID
}
```

### Migration Guide

1. **Phase 1**: Deploy with `INTERNAL_AUTH_MODE=hybrid` and both keys set
2. **Phase 2**: Update all calling services to use JWT tokens
3. **Phase 3**: Set `INTERNAL_AUTH_MODE=jwt` to enforce JWT-only
4. **Phase 4**: Remove `INTERNAL_SERVICE_TOKEN` from environment

---

## Entry Creator Display Name (BUG-CMS-8)

`cms.entry.listByDirectory`, `cms.entry.getById`, and `cms.entry.favorite.list` now ship a structured `creator` field on every entry DTO. Frontends consume it to render the real human display name instead of the legacy "Unknown owner" fallback; api_key-actor entries render a localized "Created via API key" label.

### Source layout

- `src/infra/db/schema.ts` — adds `identityUsers` as a read-only mirror of `identity.users` (schema owned by `xynes-infra`; cms-core never creates / alters / drops it).
- `src/infra/db/repositories/content-entry.repository.ts` — new `listEntryCreatorsByUserIds({ userIds })` batches the cross-schema lookup. SELECTs ONLY `id` + `displayName` from `identity.users`; never `email` / `avatar_url` / any other column.
- `src/actions/handlers/entry-management.handler.ts` — `mapEntry` accepts a `creator` option; the three list handlers (`listByDirectory`, `getById`, `favorite.list`) collect unique `createdBy` UUIDs, call the repo once per page, and pass the resolved structure down through `resolveCreator`.

### `mapEntry.creator` contract

| `createdBy` | `identityUsers` lookup | DTO `creator` |
|---|---|---|
| `null` | — | `null` (api_key actor — Story C audit policy) |
| `<uuid>` | match | `{ id, displayName }` |
| `<uuid>` | no match | `{ id, displayName: null }` (defense against orphans) |

The DTO field `createdBy` is preserved alongside `creator` for backward compatibility with any caller that still reads the raw UUID; new clients should prefer `creator` and treat `createdBy` as deprecated.

### Security invariants

- `listEntryCreatorsByUserIds` selects ONLY `id` + `displayName`. Email and avatar_url stay inside the identity schema; if the UI ever needs them they ship through a separate, narrowly-scoped action — never through the entry list payload.
- For api_key actors, `creator` is `null`. The handler NEVER constructs a partial object containing `apiKeyId` / `keyPrefix` / `keyHash` etc., so the only way for an api-key handle to reach a client through this path is a deliberate code change.
- Workspace scoping is enforced upstream at `listEntriesByDirectory` (filters on `content_entries.workspace_id`). The creator lookup operates on the UUID set sourced from that already-scoped result, so `identity.users` cannot leak across workspaces through this path.

### Tests

- `test/unit/handler-creator-display-name.test.ts` — 9 tests covering both list and getById paths, mixed user/api_key actor entries, orphan UUIDs, batching de-duplication, and a `JSON.stringify` wire-shape sweep that rejects every api-key handle from the DTO.
- `test/unit/infra/db/repositories.test.ts` — extends the dbStub-driven coverage with `listEntryCreatorsByUserIds returns empty map for empty input and selects from identity.users for non-empty`.
- `test/unit/entry-management.handler.test.ts` + `test/unit/handler-actor-audit.test.ts` — both updated to wire `listEntryCreatorsByUserIds: vi.fn()` into deps fixtures and to set `mockResolvedValue(new Map())` on the list-path tests they own.
