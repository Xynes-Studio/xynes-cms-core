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

### Directory Structure
```
src/
├── actions/              # Internal Action Registry (Feature Layer)
│   ├── handlers/         # Action handlers (business logic)
│   │   ├── _shared/
│   │   │   └── content-entry-create.ts
│   │   ├── blog-entry.handler.ts
│   │   ├── comments-create.handler.ts
│   │   ├── comments-list.handler.ts
│   │   ├── event.handler.ts
│   │   └── program.handler.ts
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
│   ├── comments-create.test.ts
│   ├── comments-list.test.ts
│   ├── program-event-create.test.ts
│   └── internal-actions.test.ts
├── unit/                 # Pure unit tests (no DB, no network)
│   ├── blog-entry.handler.test.ts
│   ├── comments-create.handler.test.ts
│   ├── comments-list.handler.test.ts
│   ├── event.handler.test.ts
│   ├── program.handler.test.ts
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

### Test File Naming
- Unit tests: `*.handler.test.ts` (mirrors handler file)
- Integration tests: `*.test.ts` (feature name)

## Database Management
- **Schema**: Defined in `src/infra/db/schema.ts` (cms schema)
- **Migrations**: managed via Drizzle Kit
    - Generate: `bun run db:generate`
    - Apply: `bun run db:migrate`
    - Push (Prototyping): `bun run db:push`
    - Seed: `bun run db:seed`

### Database Connectivity (Local vs Tunnel)
DB-backed commands (migrations, seeds, most integration tests) require a reachable Postgres instance via `DATABASE_URL`.

- **Local Postgres**: Ensure something is listening on `127.0.0.1:5432` (or update `DATABASE_URL` accordingly).
- **Supabase/VPS tunnel**: Follow `xynes-infra/infra/SSH_TUNNEL_SUPABASE_DB.md` and ensure the tunnel is up before running `bun run db:migrate`.

### Adding A New Content Type (Global Standard)
Content types are a 2-layer concept:
- **Global template** (`cms.global_content_templates`): defines `fields_schema` for a template key.
- **Workspace type** (`cms.content_types`): workspace-scoped configuration referencing `template_key`.

Implementation checklist:
1. Add a `ContentTemplateDefinition` + `WorkspaceContentTypeDefinition` to `src/infra/content-templates/index.ts`.
2. Add an idempotent migration under `drizzle/`:
   - Insert the new row into `cms.global_content_templates` (`ON CONFLICT DO NOTHING`).
   - Backfill missing `cms.content_types` for existing workspaces.
3. Update `src/infra/db/seeders.ts` to ensure the template and content type are created for new workspaces.
4. Add/extend tests:
   - Unit: schema/validation tests if you add handlers.
   - Integration: DB-backed tests that assert template/type presence and idempotency.
5. Run: `bun run lint`, `bun test --coverage` and keep coverage ≥ 75%.

### Seeding
The seed script (`bun run db:seed`) populates initial data:
- `global_content_templates`: Creates `blog_post`, `program`, `event` templates
- `content_types`: Creates Blog Post / Program / Event types for `DEFAULT_WORKSPACE_ID`

Seeding is **idempotent** - running multiple times won't create duplicates.

### CMS Tables

The CMS schema includes the following tables:

| Table | Purpose |
|-------|---------|
| `global_content_templates` | Shared field definitions for content types |
| `content_types` | Per-workspace content type configurations |
| `content_entries` | Actual content items (blog posts, events, etc.) with `status` and `publishedAt` |
| `comments` | User comments on content entries |

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
| `cms.program.create` | Create a new program entry |
| `cms.event.create` | Create a new event entry |
| `cms.comments.create` | Create a comment on an entry |
| `cms.comments.listForEntry` | List comments for an entry |

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
