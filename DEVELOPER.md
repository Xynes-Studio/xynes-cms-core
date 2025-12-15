# Xynes CMS Core Developer Guide

## Architecture

The CMS Core service is built using Bun and Hono. It manages content entries, blog posts, programs, events, and comments.

### Core Components

- **Actions**: Handler functions in `src/actions/` for each CMS operation
- **Routes**: `src/routes/internal-actions.ts` handles incoming action requests
- **Middleware**:
  - `error-handler.ts`: Standardized error envelope responses
- **Schema**: Drizzle ORM schemas in `src/infra/db/schema.ts`

## Development

### Global Standards

- **Folder Structure**: Keep boundaries clear (`actions/` vs `infra/` vs `routes/`) and prefer feature-oriented tests under `test/unit/` and `test/integration/`.
- **Testing**: TDD mandatory. 75%+ coverage via `bun run test:coverage` (DB must be reachable).
- **Linting**: Run `bun run lint` before commits.

### Action Implementation Standards

- **Action keys**: `cms.<feature>.<verb>` (e.g. `cms.program.listPublished`).
- **Handlers**: `src/actions/handlers/*` (feature files may contain multiple actions when it reduces overhead, but keep payload schemas + handlers colocated).
- **Registration**: `src/actions/index.ts` is the single source of truth for action registration.
- **DB access**: Handlers call `src/infra/db/repositories/*` (no SQL in handlers).
- **DTOs**: Return a stable DTO shape (id/slug/title/excerpt/tags/publishedAt/documentId + feature fields under `data`).

### Setup

```bash
bun install
bun run dev
```

### Database & Migrations

This service requires Postgres via `DATABASE_URL` for migrations, seed, and integration tests.

> Security note: Integration tests and seeders write to the configured database. Do not point `DATABASE_URL` at production.

Run migrations (loads `.env.dev` by default via `scripts/run-with-env.ts`):

```bash
bun run db:migrate
```

If you see DB connectivity issues on host runs, set up the Supabase/VPS SSH tunnel described in `xynes-infra/infra/SSH_TUNNEL_SUPABASE_DB.md`.

> Note: infra `.env.dev` often uses a Docker-only hostname (e.g. `db.local`). When running tests on your host through the SSH tunnel, use a `DATABASE_URL` that points to `127.0.0.1:5432` so hostname resolution works.

Quick local Postgres (Docker):

```bash
docker run --rm --name xynes-postgres \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=postgres \
  -p 5432:5432 postgres:16
```

### Testing

```bash
bun run test                # All tests (loads env file)
bun test test/unit          # Unit tests only (no env-file needed)
bun run test:coverage       # With coverage
```

### Environment

- Scripts load `.env.dev` by default (Docker/dev). Override for host runs:
  - `XYNES_ENV_FILE=.env.localhost bun run dev`
  - `XYNES_ENV_FILE=.env.localhost bun run test`

### CMS Content Templates (CMS-13)

- Global templates live in `cms.global_content_templates`.
- Workspace-specific types live in `cms.content_types`.
- CMS-13 adds `program` and `event` templates and ensures each workspace has corresponding content types via migration `drizzle/0003_silent_aurora.sql`.

Implementation detail:
- Canonical template/type definitions are centralized in `src/infra/content-templates/index.ts` and reused by `src/infra/db/seeders.ts`.

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
| `CONTENT_TYPE_TEMPLATE_MISMATCH` | 400 | Content type template mismatch |
| `ENTRY_NOT_FOUND` | 404 | Entry not found |
| `UNKNOWN_ACTION` | 404 | Action key not registered |
| `INTERNAL_ERROR` | 500 | Unexpected server error |
