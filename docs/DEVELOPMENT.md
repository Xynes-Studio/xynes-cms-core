# Development Setup

## Prerequisites
- **Bun**: Latest version (`curl -fsSL https://bun.sh/install | bash`)
- **PostgreSQL**: Local or remote instance.

## Getting Started

1.  **Install Dependencies**
    ```bash
    bun install
    ```

2.  **Environment Variables**
    Provide env vars directly, or use one of the repo env files:
    - `.env.localhost`: running on host with SSH tunnel
    - `.env.dev`: running in Docker with `db.local` host mapping

    Service scripts default to `.env.dev`. Override for host runs:
    ```bash
    XYNES_ENV_FILE=.env.localhost bun run dev
    ```

    Environment variables:
    ```bash
    PORT=3000
    DATABASE_URL=postgres://user:pass@localhost:5432/cms
    DEFAULT_WORKSPACE_ID=your-workspace-uuid
    INTERNAL_SERVICE_TOKEN=change-me-to-a-long-random-secret
    ```

    > **Note for Docker**: When running via `docker-compose`, use `DATABASE_URL=postgres://...@host.docker.internal:5432/postgres` (see `xynes-infra`).

3.  **Run Development Server**
    ```bash
    bun run dev
    ```

## Architecture

- **Framework**: Hono (Lightweight, fast web standard based)
- **Runtime**: Bun
- **ORM**: Drizzle
- **Validation**: Zod

## Global Standards

These standards are shared across Xynes services to reduce future tech debt and keep onboarding easy.

- **Segregation**: Keep business logic in action handlers; keep all DB access in repositories; keep HTTP glue in routes.
- **Security**: Always scope by `workspaceId`; validate all inputs with Zod; default to `z.strict()` for internal actions to prevent over-posting.
- **Testing (TDD)**: Add tests first/alongside changes; keep unit tests pure; add integration tests for multi-step flows. See `docs/adr/001-testing-strategy.md`.
- **Coverage**: Minimum **75%** line/branch coverage via `bun run test:coverage`.

### Frontend Integration (Next.js / React)

This service exposes **internal** CMS actions; browser clients must not call them directly.

- Call through the gateway/server-side layer; never ship `INTERNAL_SERVICE_TOKEN` to the browser.
- Treat `content_types.routeSegment` as the URL segment for generic routes (e.g. `/workspaces/:workspaceId/content/:routeSegment`); keep `slug` for internal/admin identifiers.
- Prefer typed API clients (shared contracts) and add UI tests for critical flows that depend on content routing.

### Directory Structure
```
src/
├── actions/              # Internal Action Registry (Feature Layer)
│   ├── handlers/         # Action handlers (business logic)
│   │   ├── blog-entry.handler.ts
│   │   ├── blog-entry-update-meta.handler.ts
│   │   ├── comments-create.handler.ts
│   │   ├── comments-list.handler.ts
│   │   ├── templates-list-global.handler.ts
│   │   └── content-types-list-for-workspace.handler.ts
│   ├── errors.ts         # Custom error classes
│   ├── execute.ts        # Action executor
│   ├── index.ts          # Action registration (entry point)
│   ├── registry.ts       # Registry implementation
│   └── types.ts          # Types and interfaces
├── infra/                # Infrastructure Layer
│   ├── db/               # Database layer
│   │   ├── repositories/ # Repository pattern implementations
│   │   │   ├── comment.repository.ts
│   │   │   ├── content-entry.repository.ts
│   │   │   ├── content-type.repository.ts
│   │   │   ├── global-content-template.repository.ts
│   │   │   └── index.ts  # Barrel export
│   │   ├── index.ts      # DB client export
│   │   ├── migrate.ts    # Migration runner
│   │   ├── schema.ts     # Drizzle schema definitions
│   │   ├── seed.ts       # Seed script entry point
│   │   └── seeders.ts    # Reusable seed functions
│   ├── config.ts         # Environment configuration
│   └── logger.ts         # Logging utilities
├── middleware/           # Global middleware (Error handling)
├── routes/               # API Route definitions
│   ├── health.ts         # Health check endpoint
│   ├── ready.ts          # Readiness check endpoint
│   └── internal-actions.ts # CMS actions endpoint
└── index.ts              # Application entry point

test/
├── integration/          # Integration tests (with DB)
│   ├── blog-entry.test.ts
│   ├── cms-meta-actions.test.ts
│   ├── comments-create.test.ts
│   ├── comments-list.test.ts
│   └── internal-actions.test.ts
├── unit/                 # Pure unit tests (no DB, no network)
│   ├── blog-entry.handler.test.ts
│   ├── comments-create.handler.test.ts
│   ├── comments-list.handler.test.ts
│   ├── content-types-list-for-workspace.handler.test.ts
│   ├── templates-list-global.handler.test.ts
│   └── registry.test.ts
└── *.test.ts             # Feature-level tests (may require DB)
```

### Repository Pattern

All database operations follow the **Repository Pattern** for separation of concerns:

```typescript
// Example: comment.repository.ts
export async function createComment(input: CreateCommentInput): Promise<Comment>
export async function listCommentsForEntry(options: ListCommentsOptions): Promise<Comment[]>
export async function findEntryByIdAndWorkspace(entryId: string, workspaceId: string): Promise<Entry | null>
```

**Key principles:**
- Repositories encapsulate all DB queries
- Handlers call repositories, never DB directly
- Use workspace-aware queries for multi-tenant security

### Action Handler Pattern

Each action follows a consistent pattern:

```typescript
// 1. Define Zod schema for payload
export const MyActionPayloadSchema = z.object({...});

// 2. Export inferred type for consumers
export type MyActionPayload = z.infer<typeof MyActionPayloadSchema>;

// 3. Implement handler with ActionContext
export async function handleMyAction(
  payload: MyActionPayload,
  ctx: ActionContext
): Promise<Result> {
  // Validate ownership
  // Execute business logic
  // Return result
}
```

## Testing Strategy

We follow **TDD** principles.
- **Coverage Goal**: Minimum 75% branch/line coverage.
- **Run Tests**: `bun test`
- **Check Coverage**: `bun run test:coverage`

### Test Organization
- `test/unit/` - Pure unit tests (no DB, no network)
  - Schema validation tests
  - Error class tests
  - Pure function tests
- `test/integration/` - Integration tests with external dependencies
  - Full HTTP request/response tests
  - Database operations
- `test/*.test.ts` - Feature-level tests (may require DB)

### Running Integration Tests Locally (Docker Postgres)

If you don’t have a local Postgres (or an SSH tunnel), use the repo’s test DB compose:

```bash
docker compose -f docker-compose.test.yml up -d
cp .env.test.example .env.test.local
XYNES_ENV_FILE=.env.test.local bun run scripts/run-with-env.ts run src/infra/db/migrate.ts
RUN_INTEGRATION_TESTS=true XYNES_ENV_FILE=.env.test.local bun run test:coverage
docker compose -f docker-compose.test.yml down -v
```

### Running Integration Tests via SSH Tunnel (Recommended)

If you already have the platform SSH tunnel to Supabase Postgres running, you can run the CMS integration tests against that DB instead of starting a local container.

1. Start the tunnel (from `xynes-infra/infra/SSH_TUNNEL_SUPABASE_DB.md`):
   ```bash
   ssh -N -L 5432:127.0.0.1:5432 xynes@84.247.176.134
   ```

2. Set up `.env.localhost` (you can copy `.env.test.tunnel.example`) and set:
   - `DATABASE_URL` pointing at `127.0.0.1:5432`
   - `INTERNAL_SERVICE_TOKEN` (must match gateway + other services)

3. Run migrations + coverage:
   ```bash
   XYNES_ENV_FILE=.env.localhost bun run scripts/run-with-env.ts run src/infra/db/migrate.ts
   RUN_INTEGRATION_TESTS=true XYNES_ENV_FILE=.env.localhost bun run test:coverage
   ```

### Test File Naming
- Unit tests: `*.handler.test.ts` (mirrors handler file)
- Integration tests: `*.test.ts` (feature name)

## Database Management
- **Schema**: Defined in `src/infra/db/schema.ts` (cms schema)
- **Migrations**: managed via Drizzle Kit
    - Generate: `bun run db:generate`
    - Apply: `bun run src/infra/db/migrate.ts`
    - Push (Prototyping): `bun run db:push`
    - Seed: `bun run db:seed`

### Seeding
The seed script (`bun run db:seed`) populates initial data:
- `global_content_templates`: Creates `blog_post` template
- `content_types`: Creates BlogPost type for `DEFAULT_WORKSPACE_ID`

Seeding is **idempotent** - running multiple times won't create duplicates.

### CMS Tables

The CMS schema includes the following tables:

| Table | Purpose |
|-------|---------|
| `global_content_templates` | Shared field definitions for content types |
| `content_types` | Per-workspace content type configurations |
| `content_entries` | Actual content items (blog posts, events, etc.) with `status` and `publishedAt` |
| `comments` | User comments on content entries |

### Content Types: `slug` vs `routeSegment`

`cms.content_types` includes:
- `slug`: internal identifier (often used for admin/UI labeling).
- `route_segment` (`routeSegment` in APIs): URL-safe segment used for generic routing like `/workspaces/:workspaceId/content/:routeSegment`.

Constraints:
- `route_segment` is **required** and **unique per workspace** (DB-enforced).

#### Comments Table

The `cms.comments` table supports threaded comments on content entries:

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `workspace_id` | uuid | Multi-tenant boundary |
| `entry_id` | uuid | FK → `content_entries.id` |
| `parent_id` | uuid | Self-FK for threaded replies (null = top-level) |
| `user_id` | uuid | Authenticated user ID (optional) |
| `display_name` | text | Guest display name (optional) |
| `content` | text | Comment body |
| `status` | text | `pending` \| `approved` \| `rejected` \| `hidden` |
| `created_at` | timestamptz | Creation timestamp |
| `updated_at` | timestamptz | Last update timestamp |

**Indexes:**
- `(workspace_id, entry_id, created_at)` - For listing comments on an entry
- `(parent_id)` - For threaded queries

## Available Actions

See [CMS_ACTIONS.md](./CMS_ACTIONS.md) for complete action documentation.

| Action Key | Description |
|------------|-------------|
| `cms.blog_entry.create` | Create a new blog entry |
| `cms.blog_entry.read` | Read entries by content type |
| `cms.blog_entry.listPublished` | List published blog entries (public feed) |
| `cms.blog_entry.getPublishedBySlug` | Get a published blog entry by slug |
| `cms.blog_entry.listAdmin` | List all blog entries (admin table) |
| `cms.blog_entry.updateMeta` | Update blog metadata + publish state |
| `cms.comments.create` | Create a comment on an entry |
| `cms.comments.listForEntry` | List comments for an entry |
| `cms.templates.listGlobal` | List global templates |
| `cms.content_types.listForWorkspace` | List workspace content types (optional template join) |

## Linting
Run `bun run lint` to check for code style issues.

## NPM Scripts Reference
| Script | Description |
|--------|-------------|
| `dev` | Start dev server with hot reload |
| `start` | Start production server |
| `test` | Run tests |
| `test:coverage` | Run tests with coverage report |
| `db:generate` | Generate Drizzle migrations |
| `db:push` | Push schema changes (prototyping) |
| `db:seed` | Seed initial data |
| `lint` | Run Biome linter |
