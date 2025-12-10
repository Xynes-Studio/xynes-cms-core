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
- `src/infra`: Infrastructure/Configuration (DB, Logger, Env)
- `src/middleware`: Global middleware (Error handling)
- `src/routes`: API Route definitions
- `test`: Bun test files

## Testing Strategy
We follow **TDD** principles.
- **Coverage Goal**: Minimum 75% branch/line coverage.
- **Run Tests**: `bun test`
- **Check Coverage**: `bun run test:coverage`

## Database Management
- **Schema**: Defined in `src/infra/db/schema.ts`
- **Migrations**: managed via Drizzle Kit
    - Generate: `bun run db:generate`
    - Push (Prototyping): `bun run db:push`

## Linting
Run `bun run lint` to check for code style issues.
