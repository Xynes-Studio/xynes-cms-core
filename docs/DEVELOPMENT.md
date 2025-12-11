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
    Create a `.env` file (or let Bun read from system env):
    ```bash
    PORT=3000
    DATABASE_URL=postgres://user:pass@localhost:5432/cms
    DEFAULT_WORKSPACE_ID=your-workspace-uuid
    ```

3.  **Run Development Server**
    ```bash
    bun run dev
    ```

## Architecture
- **Framework**: Hono (Lightweight, fast web standard based)
- **Runtime**: Bun
- **ORM**: Drizzle

### Directory Structure
```
src/
├── actions/          # Internal Action Registry
├── infra/            # Infrastructure/Configuration
│   ├── db/           # Database layer
│   │   ├── index.ts      # DB client export
│   │   ├── migrate.ts    # Migration runner
│   │   ├── schema.ts     # Drizzle schema definitions
│   │   ├── seed.ts       # Seed script entry point
│   │   └── seeders.ts    # Reusable seed functions
│   ├── config.ts     # Environment configuration
│   └── logger.ts     # Logging utilities
├── middleware/       # Global middleware (Error handling)
├── routes/           # API Route definitions
└── index.ts          # Application entry point

test/
├── integration/      # Integration tests
├── unit/             # Unit tests
└── *.test.ts         # Feature-level tests
```

## Testing Strategy
We follow **TDD** principles.
- **Coverage Goal**: Minimum 75% branch/line coverage.
- **Run Tests**: `bun test`
- **Check Coverage**: `bun run test:coverage`

### Test Organization
- `test/unit/` - Pure unit tests (no DB, no network)
- `test/integration/` - Integration tests with external dependencies
- `test/*.test.ts` - Feature-level tests (may require DB)

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
