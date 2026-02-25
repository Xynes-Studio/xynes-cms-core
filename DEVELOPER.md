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
- Workspace directory tree persistence: `cms.content_directories.listForWorkspace` + `cms.content_directories.create`

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
  - Enforce DB-level uniqueness for both root and nested directories:
    - root: unique `(workspace_id, path_segment)` where `parent_id IS NULL`
    - nested: unique `(workspace_id, parent_id, path_segment)` where `parent_id IS NOT NULL`
- Tech-debt controls:
  - Keep transform/validation logic in handlers, persistence logic in repositories.
  - Reuse existing content-type repository helpers rather than duplicating workspace checks.
  - Preserve idempotent/append-only migration workflow (new migration files only).

## Routes

- `GET /health`: Liveness check. Returns `{ "status": "ok", "service": "xynes-cms-core" }`.
- `GET /ready`: Readiness check. Runs a fast Postgres check and returns `{ "status": "ready" }` (or 503 with error).

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
