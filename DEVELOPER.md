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
| `ENTRY_NOT_FOUND` | 404 | Entry not found |
| `UNKNOWN_ACTION` | 404 | Action key not registered |
| `INTERNAL_ERROR` | 500 | Unexpected server error |
