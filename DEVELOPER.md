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

### Publication snapshots (CMS-INT-A2)

All CMS create-with-publish, explicit publish/status and due scheduled promotion use `content-publication.repository.ts`. Publication locks the latest workspace-scoped row and writes its snapshot, status and publication time in one transaction. Saving a published entry preserves the old snapshot, including its published folder. Republish replaces it; validation or DB failure rolls back the entire publication. API-key actors retain nullable audit IDs. No new routes, permissions, dependencies or environment variables are introduced.

`published_snapshot` is nullable, version 1: `{ version, directoryId, entry: { id, title, description, tags, publishedAt, body } }`. Public values are copied from the draft; private author/audit fields are omitted. A1 bounds apply (title 1–200 characters, description ≤4000, ≤50 tags of 1–80 characters). The entire UTF-8 serialized snapshot is limited to **1 MiB**, with no truncation; this comfortably fits the tested 500-paragraph rich article fixture. Stable errors are `PUBLICATION_INVALID` and `PUBLICATION_TOO_LARGE` (400). A3 projects summaries in SQL before body materialization; maximum 100 summary rows stay independently bounded by A1 (including JSON escaping), rather than multiplying the body budget by 100.

The editor validator supports version-1 Lumia/Lexical rich text, lists, links, code, tables, panels, statuses and image/video/file nodes. It permits only each node's documented fields, ≤64 nesting levels and ≤10,000 nodes. Formatting accepts plain color/font/text-decoration declarations and rgb/hsl values; resource references, CSS escapes/comments and unsupported properties/functions are rejected. Known Lexical 0.38.2 null link attributes and cell background colors are supported, along with typed table striping/frozen counts/cell alignment and code theme. A pinned actual editor-export fixture guards serializer compatibility. Unknown node versions/fields fail publication. Supported external media/links require safe protocols without recognized credential/signing query parameters or authenticated storage paths. Query keys are decoded by URLSearchParams, compared case-insensitively with underscore/hyphen normalization, and reject prefixed token/API-key/secret/password/credential/authorization/signature names (including `access_token`, `auth_token`, `api_key`) plus provider signing prefixes and common bare credential keys. Ordinary media query parameters such as video IDs, timestamps and resize dimensions remain supported. Storage-backed image nodes retain a UUID `objectId`, clear `src`, and omit upload status; pending uploads fail publication. This is JSON delivery, not an HTML renderer. Snapshot creation never signs URLs or bypasses storage's scan-success/download gates; consumers must resolve object references through the existing authorized storage flow.

Authoring DTOs add `deliveryState`: `available` only for a valid matching snapshot on a live published, due, non-deleted entry; `republish_required` for a live published entry with a missing/invalid snapshot; otherwise `unpublished`. Reads and authoring use the same validator. Draft data never substitutes for a missing snapshot. Legacy raw-entry responses omit snapshot, fingerprint, validation flag and failure metadata. **CMS-INT-A3 now extends the snapshot guarantee to legacy generic/blog public reads**, as explicitly approved on 2026-10-02. Those endpoints read frozen publication fields and require republishing when valid frozen legacy metadata is absent. Authenticated authoring reads continue to return current drafts.

#### Legacy public delivery hardening (CMS-INT-A3)

Generic `cms.content.{listPublished,getPublishedBySlug}` and blog `cms.blog_entry.{listPublished,getPublishedBySlug}` now serve the last validated publication. Publication optionally captures a closed `legacy` object alongside the v1 entry: slug (1–200 trimmed characters), optional excerpt (≤4000), optional cover URL (≤2048 and the same safe-URL policy), and nullable document UUID. The object is internal metadata, never added to the A1 delivery DTO. Slug lookup and tag filtering read frozen snapshot fields. Title/tags/body/publication time also come from that snapshot. A save cannot change delivered values; valid republish can.

Legacy envelopes and documented summary fields remain. Generic detail `data` becomes an explicit public allowlist (slug/title/description/tags/body plus supplied excerpt/cover); arbitrary template fields, author/audit properties and current draft fields are excluded. Consumers relying on undocumented `data` fields must adapt. Historical snapshots lacking frozen legacy fields return unavailable until explicit republish; there is no fallback or automatic draft backfill. Malformed bodies, recognized credential URLs, identity/time mismatches and hidden publications are rejected for delivery. Draft authoring is unchanged and still accepts draft JSON: this change prevents public exposure, rather than claiming every saved external URL is credential-free.

The isolated PostgreSQL legacy regression covers unrepublished slug/tag/title/body/cover edits, recognized credential URLs, publish rejection, republish, historical and foreign entries, and document references. Public detail reads select only bounded publication/state fields. Both legacy list paths project summary/legacy metadata in SQL and substitute an internal null body before reusing the bounded summary validator; editor bodies are never transferred or parsed for lists. Eligibility/fingerprint predicates still inspect the original stored publication. Neither public path fetches unrestricted current drafts or private audit columns.

#### Bounded folder and entry delivery (CMS-INT-A3)

`cms.delivery.listByDirectory` and `cms.delivery.getById` are registered on the existing internal CMS action boundary. A4 owns public gateway route seeds, read permissions and API-key preset scopes; A3 does not provision live routes or keys. The private workspace-scoped target routes are `GET /workspaces/:workspaceId/delivery/entries` and `GET /workspaces/:workspaceId/delivery/entries/:entryId`.

Folder inputs require a directory UUID. `sortBy` is `publishedAt` (default) or `title`; `sortDirection` defaults to `desc` and also accepts `asc`. Limit defaults to 20, ranges 1–100; offset defaults to 0, ranges 0–10000. Optional search is trimmed nonempty text of at most 200 characters and performs literal, case-insensitive contains matching against published title/description, with SQL wildcards escaped. The coordinated gateway patch preserves numeric/boolean-looking search strings while still coercing pagination numbers. No root/unscoped folder request is supported.

`fields` is a CSV string of at most 128 characters. Summary fields are `id,title,description,tags,publishedAt`; detail also allows `body`. Defaults include all fields for the respective endpoint; `id` is always included. Duplicate/empty/unknown selections, unknown parameters, status/preview overrides and HTML output are rejected. Folder queries select bounded summary values only, read at most limit+1 rows, and return `{items,page:{limit,offset,hasMore}}`, with no total/count query. Detail reads at most one validated 1 MiB publication. Neither public path materializes current draft JSON. Published-date ordering uses publication time then UUID; title ordering uses PostgreSQL C collation, then publication time and UUID. All tie-breaks use the requested direction. Offset pagination is deterministic for unchanged publications, not a transactional snapshot across separate requests.

Eligibility requires the request workspace, frozen publication folder, live published status, due time, no deletion, matching identity/time and a matching validation fingerprint. Missing/changed/malformed/historical publications are excluded before paging; detail returns the same 404 `ENTRY_NOT_FOUND` / `Published content unavailable`. Empty folders are successful; database outages propagate instead of becoming empty feeds. JSON DTOs contain only approved fields. Bodies retain the bounded A2 Lumia/Lexical contract; no HTML rendering, media signing or storage-gate bypass is added. A1's illustrative detail body fixture is not a second editor format.

`drizzle/0009_cms_publication_validation.sql` adds nullable `published_snapshot_digest` and two partial workspace/published-folder ordering indexes. Publication writes a `v1:` SHA-256 fingerprint over PostgreSQL canonical JSONB text after full validation, atomically with the snapshot; saves preserve both. Reads recompute it in SQL before pagination. This proves the persisted value has not changed since service validation; it is not authentication against a privileged writer able to replace both snapshot and hash. Policy changes must version this validation proof and require fresh validation. Fingerprinting can read bodies inside PostgreSQL even though folder result materialization excludes them. Index diagnostics pass on the isolated fixture; no production latency or full-text indexing claim is made.

Before rollout, back up the target schema/journal and apply 0009 through the approved migration process before starting this CMS version. Index creation is transactional and may block writes on a large table; plan an appropriate maintenance window. Deploy the small gateway transport patch together with A4 route/permission/scope wiring. Keep nullable columns on application rollback; old writers may create ineligible publications requiring explicit republish. Existing A2 snapshots deliberately retain NULL fingerprints and require normal republish; do not copy drafts or manufacture hashes to backfill. Missing/invalid proof also produces authoring `republish_required`, while drafts/hidden/future entries remain `unpublished`. After isolated validation, the user authorized applying 0009 to local Supabase on 2026-10-02. A complete database backup was verified first; all 42 entries and existing rows across all seven CMS tables were unchanged afterward, the nullable column/two indexes were verified, and CMS health/readiness remained HTTP 200. Historical fingerprints were not backfilled. The watched primary CMS checkout remains on merged A2; republish for A3 delivery must happen after deploying A3 code. No hosted database was migrated.

See [A3 validation and per-file coverage](docs/verification/2026-10-02-legacy-publication-delivery.md).

#### Scheduler recovery

Scheduling validates content immediately. Due legacy/changed content is validated again under the row lock. Each bad row is isolated; permanent validation/budget failures record only `{ revision, code, attempts, nextAttemptAt }` without changing source `updated_at`. Failure recording locks again and compares captured draft data, folder and schedule as well as the timestamp, so a concurrent same-millisecond repair is not blocked by stale recovery. The failed revision is excluded until an edit or explicit reschedule clears the marker. Transient failures retry after 30 then 60 seconds, at most three attempts, then remain `RETRY_EXHAUSTED` until edit/reschedule. Operators should repair invalid content, resolve the transient service/DB issue, and use the normal edit/reschedule actions; never manufacture a snapshot from current draft data.

Each scheduler run uses one owned PostgreSQL session for advisory-lock acquisition/release and closes it in `finally`; row publication uses separate short transactions. A run processes at most 20 batches (default 50, hard maximum 200 entries per batch), visits each ID once, and stops on no progress. Errors are logged with safe fixed codes, never draft text or raw DB errors. If the database cannot persist failure bookkeeping, the run still skips that ID and continues; a later timer run can retry because no durable marker exists. This is a deployment limitation, not a guarantee of bounded retries during a complete DB outage. The owned advisory lock requires session-affine PostgreSQL access; transaction-pooling proxies must use a session endpoint for this service.

#### Migration and rollback

`drizzle/0008_cms_published_snapshot.sql` adds only two nullable JSONB columns (`published_snapshot`, `scheduled_publication_failure`) and column comments; the journal registers it after 0007. No existing rows are backfilled. Historical published entries require explicit republish before new delivery can serve them. The repository's 0005–0007 migrations already use handwritten SQL/journal without generated schema snapshots; 0008 follows that existing pattern. Existing metadata drift and the mirrored identity schema must be reconciled deliberately before future `drizzle-kit generate`; do not generate a destructive cross-schema migration.

Before any environment application, take a backup, inspect the actual migration journal/schema, and run the forward migrator in the approved deployment workflow. The initial story verification migrated only a backed-up disposable PostgreSQL fixture. A subsequent user-approved local recovery applied 0008 to local Supabase after verifying a backup and the existing journal; no shared/hosted database was touched. Roll back application code while retaining the nullable columns; do not drop data or rewrite migration history. An old application may publish without capturing snapshots, requiring explicit republish after re-enabling this feature.

#### Local environment smoke and recovery

Apply 0008 and 0009 before running this A3 branch against a local/shared database. A bind-mounted source update does not apply migrations, and `/health`/`/ready` do not verify these columns. Back up `cms` and the Drizzle journal, inspect pending migrations, then run the CMS migrator in the approved environment. Do not reset Supabase or backfill publications to resolve a missing-column error.

The development Compose stack also persists `/app/node_modules` in a named volume. Rebuilding an image does not replace that existing volume. Before migration/runtime verification, synchronize it with `docker compose --env-file .env.dev -f docker-compose.dev.yml exec cms-core bun install --frozen-lockfile`, then restart only `cms-core`. The October 1 local smoke caught Drizzle 0.29.5 in that volume despite the current lockfile requiring 0.45.2: the old driver double-encoded JSON and truncated publication timestamps. Use the pinned dependencies; do not weaken snapshot validation to accept those writes. Historical or malformed publications require normal explicit republish after dependency repair.

From this repository, run:

```bash
SMOKE_ALLOW_WRITES=true WORKSPACE_ID=<workspace-uuid> XS_USER_ID=<owner-uuid> \
XYNES_ENV_FILE=../xynes-infra/.env.localhost bun run smoke:publication
```

The selected env must provide `DATABASE_URL`, gateway-owned `INTERNAL_REQUEST_PRIVATE_KEY_FILE` and `INTERNAL_REQUEST_KEY_ID`; `CMS_CORE_URL` defaults to `http://localhost:4202`. Supply an actual authorized workspace owner, not a random user. This opt-in smoke checks required columns and authoring listing before any writes, creates one uniquely named entry, and exercises publish, draft-save isolation, republish, credential-bearing URL rejection with snapshot preservation, repair via `status.set`, and draft/scheduled/archived delivery gates. It soft-deletes its fixture in `finally`, including on assertions/request failures. No schema changes, tenant backfill or user-content edits are performed. HTTP and DB operations have execution bounds; errors omit response bodies and credentials. Run only in local/staging environments where fixture writes are allowed.

A2 has no new delivery routes. A3 registers internal delivery actions; A4 provisions their gateway routes and scopes. The smoke verifies stored publication snapshots and existing authoring APIs; its original A2 evidence does not cover the subsequently hardened legacy public endpoints; A3 adds isolated regressions for those reads. Scheduled promotion remains covered by the isolated database integration suite; the live smoke schedules safely in 2099 instead of touching other due tenant entries.

Verification commands and per-file coverage evidence are recorded in [the A2 implementation plan](docs/plans/2026-10-01-CMS-INT-A2-publication-snapshots.md). The task requires ≥80% lines/functions despite the older ADR's 75% minimum. Bun does not expose branch coverage or function identities in LCOV; combined function coverage is conservatively reported, never fabricated. Existing legacy `ContentEntryData`/repository casts and older mock `any` types remain follow-up debt; new publication code uses inferred Drizzle types and Zod validation without type suppressions or relaxed TypeScript settings.

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

Internal requests require Ed25519 signatures bound to receiver, operation, exact body and actor/workspace/request headers. Shared tokens, HS256 service tokens and hybrid fallback are rejected.

Receivers require `INTERNAL_REQUEST_TRUST_FILE` containing only permitted callers' public keys. Callers require their own `INTERNAL_REQUEST_PRIVATE_KEY_FILE` and `INTERNAL_REQUEST_KEY_ID`. Never distribute a caller private key in a shared env file or mount it in a sibling. Deploy all seven compatible services together and follow [the identity runbook](../xynes-infra/infra/release/INTERNAL-REQUEST-IDENTITIES.md) for provisioning and rotation. Protocol source and checked mirrors belong to platform-contracts.

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

## SEC-003-FU-1 current internal authentication

Internal actions now require Ed25519 requests bound to receiver, operation, exact
body, actor, workspace and request id. Historical shared-token/hybrid instructions
in this document no longer apply to authentication. Receivers fail closed without
public trust; callers load only their own signing file. Shared static/HS256 tokens
are rejected, including authz read checks. Follow the backend infra identity
runbook for coordinated seven-service rollout and rotation. Protocol mirrors are
generated from platform-contracts and must be changed/exported there; validate
`corepack pnpm internal-request:check` with the backend workspace present.

### CMS-INT-A4 registered access smoke

`test/integration/content-delivery-access.test.ts` is explicitly opt-in via
`RUN_CMS_DELIVERY_ACCESS_TESTS=true`. Infra's
`scripts/test/cms-delivery-access-smoke.test.sh` backs up an explicitly disposable
`cms_int_a4_*` loopback database before preparing canonical route/key tables.
Supply explicit CMS/gateway/accounts/infra checkout paths. Both launcher and
direct backup subprocesses strip inherited libpq connection overrides before
setting the validated database/host. The launcher safety check runs without a
database; `test/unit/delivery-access-safety.test.ts` covers direct-invocation
URL guards and the typed `test/integration/libpq-env.ts` helper. Enabled runs fail on
missing prerequisites. Ordinary unit runs skip this DB/HTTP fixture.

The fixture builds actual issuer/gateway source, issues runtime-only keys,
loads registered routes, and starts ephemeral loopback gateway/CMS servers.
It tests published list/detail, projection, empty folder, invalid inputs,
old-key replacement, expiry/revocation/workspace isolation, publish/save/republish
and disable/restart rollback. Teardown restores the caller's exact CMS_CORE_URL
state, including unset/empty values; failed setup uses the same cleanup path. The caller owns the fresh database and teardown;
the harness never drops a shared database or starts the CMS scheduler. This is
A4 access proof; A5 still joins Agent B's copied requests and browser flow.
