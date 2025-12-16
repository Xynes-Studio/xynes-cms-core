# ADR-001: Testing Strategy (TDD + Coverage)

## Status
Accepted

## Context
This service ships internal CMS actions used by admin/UIs. Regressions are costly and hard to detect via manual QA alone, so we standardize on **TDD** and automated coverage gates.

## Decision
We follow a test pyramid with explicit separation:

- **Unit tests** (`test/unit/**`): No DB, no network. Focus on payload validation, pure functions, and edge cases.
- **Integration tests** (`test/integration/**`): DB-backed flows and multi-step behaviour validation.
- **Feature tests** (`test/*.test.ts`): End-to-end HTTP request/response behaviour (may hit DB).

Coverage standard:
- **Minimum 75%** line/branch coverage on CI for the service.
- Coverage is measured by `bun test --coverage` (or `bun run test:coverage`).

## Consequences
- New actions should be implemented in TDD order: schema tests → unit logic tests → integration flow test.
- Behaviour changes must be accompanied by tests that would fail without the change.
- DB-backed tests must be workspace-scoped and avoid shared global fixtures that can leak state.

## Notes
- Payload schemas should be `z.strict()` (or explicitly `.passthrough()` when required) to reduce accidental over-posting.
- Workspace isolation is considered a security boundary and must be exercised in integration tests.

