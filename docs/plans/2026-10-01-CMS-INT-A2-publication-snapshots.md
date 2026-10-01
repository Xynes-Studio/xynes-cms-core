# CMS-INT-A2 publication snapshots implementation plan

**Goal:** Keep the last publication unchanged until explicit republish, across immediate and scheduled publishing.

**Architecture:** A pure publication validator/sanitizer produces a versioned bounded DTO. A shared repository transaction locks the latest persisted row before changing publication state; draft saves retain snapshots. Existing action authentication and nullable actor audit fields remain authoritative. CMS owns the additive migration. Delivery HTTP handlers remain A3.

**Tech stack:** Existing Bun, Hono, Zod 4, Drizzle/PostgreSQL. A1 metadata is pinned from platform-contracts develop `141e32a` with its unchanged SHA-256 digest in test fixtures; no cross-repository runtime import or package publication.

## Execution

1. Establish baseline before application changes: locked dependencies, `bun test test/unit`, `bun run typecheck`, `bun run lint`, and existing migrations/integration runner against a newly initialized disposable PostgreSQL cluster. Never load a shared developer environment for integration tests.
2. Write failing snapshot tests: copy public fields; bounds, serialized 1 MiB limit, editor/storage sanitization, malformed snapshots and consistent availability. Implement the pure helper, then run `bun test test/unit/publication-snapshot.test.ts`.
3. Write a failing real-DB publication/save/republish test. Add migration 0008 and journal entry with nullable snapshot/failure columns, no backfill and no destructive operations. Take a disposable DB backup before applying it. Implement row-lock transaction and route create/update/status/scheduled publication through it. Prove ordering and rollback with PostgreSQL, including a failed write.
4. Write failing scheduler isolation/retry tests. Bound per-run batches; persist safe failure/retry metadata tied to the locked draft revision, with edit/reschedule recovery. Ensure invalid first rows cannot starve later valid entries. Exercise real DB outcomes.
5. Add authoring deliveryState using the same snapshot validator and live/due/deleted predicates. Preserve legacy response shapes and omit new raw snapshot/failure metadata. Update actor/status/legacy regression tests and the integration runner.
6. Run full unit, isolated integration, coverage, lint, typecheck and a Bun production build check. Require at least 80% lines/functions for every changed executable source file and overall, report Bun's supported metrics honestly. Independently review the migration/security/transaction diff and document recovery, rollback and remaining A3–A5 work.

No shared/hosted DB application, backfill, deployment, push or PR creation is part of this task.

## Completion evidence — 2026-10-01

Branch: `feature/CMS-INT-A2-publication-snapshots`, based on freshly pulled cms-core develop `35c3904`. A1 metadata came from freshly pulled platform-contracts develop `141e32a` (merged PR #5). Pinned artifact SHA-256: `24a21f502809f6396e9afde4482508743d8aaf8bf2f1bef2de1d6d547b6e3f1e`. No other repository implementation was changed.

Baseline: 400 unit tests passed, original 11-file integration runner passed, lint/typecheck passed after restoring the existing locked dev dependencies (`bun install --frozen-lockfile`, no manifest/lock changes). Missing local TypeScript tooling was an environment issue; no baseline type errors were suppressed. TDD failures demonstrated missing snapshots/availability, scheduler abort/no-progress, legacy metadata leakage, microsecond retry filtering, CSS signed-URL preservation and same-timestamp stale recovery. A real PostgreSQL contention test reproduced the original advisory-lock session mismatch before its fix.

Final verification:

| Check | Result |
| --- | --- |
| `XYNES_ENV_FILE=<isolated-unit.env> bun run test test/unit` | 418 passed, 0 failed (26 files) |
| `XYNES_ENV_FILE=<isolated-unit.env> bun run test:coverage --coverage-reporter=lcov --coverage-dir=<unit-coverage>` | 492 passed, 77 intentionally DB-gated skips, 0 failed (44 files) |
| `XYNES_ENV_FILE=<isolated-fixture.env> bun run test:integration` | 96 passed, 0 skipped/failed across the configured 12 subprocesses; includes 12 publication integration cases |
| Coverage of each configured integration file, one subprocess per file with authz preload | All 12 cohorts passed; same isolated DB, source identical to unit cohort |
| `bun run lint` | 47 source files clean |
| `bun run typecheck` | `tsc --noEmit` passed, strictness unchanged |
| `bun build src/index.ts --target=bun --outdir=<temporary-build>` | 281 modules bundled, 1.17 MB artifact; repo has no build script |
| `git diff --check` | Passed |
| Independent read-only review | Advisory lock, formatting and stale-recovery findings fixed; regression recheck 2 passed/0 failed, no remaining blocker |

Real PostgreSQL cases cover publish A/save B/republish; folder freezing; API-key authoring and nullable audit IDs; legacy DTO privacy and republish state; validation and trigger-induced DB rollback; a concurrent writer holding a row lock while publish waits; archive/unpublish/delete and tenant/type scoping; invalid/oversized first due rows followed by valid rows; durable permanent-failure exclusion/edit recovery; transient 30/60-second backoff with three-attempt exhaustion/reschedule; session-owned advisory lock release while the application pool is busy. Harmless rich-editor fixtures and UTF-8/escaped-summary bounds are covered separately. No resource-exhausting fixture is used.

### Coverage gate

LCOV line hits were unioned by source path/line across the configured unit and isolated integration cohorts. Bun's LCOV has no function identities or branch metrics: function counts use the maximum observed hit count per unchanged file divided by its function count, a **conservative lower bound**, not an invented exact union. Every changed executable source file and the overall service satisfy ≥80% lines/functions. Script runner registration, SQL and JSON metadata are verified by execution/schema checks rather than assigned fabricated coverage percentages.

| Source file | Line coverage | Function coverage lower bound |
| --- | ---: | ---: |
| `src/actions/publication-snapshot.ts` | 93.30% (334/358) | 100.00% (15/15) |
| `src/infra/db/repositories/content-publication.repository.ts` | 97.74% (173/177) | 100.00% (12/12) |
| `src/infra/db/repositories/content-entry.repository.ts` | 85.74% (451/526) | 96.15% (50/52) |
| `src/infra/db/schema.ts` | 100.00% (175/175) | 100.00% (11/11) |
| `src/scheduling/scheduled-entry-publisher.ts` | 82.32% (135/164) | 84.62% (11/13) |
| `src/actions/handlers/entry-management.handler.ts` | 80.05% (642/802) | 100.00% (53/53) |
| `src/actions/handlers/blog-entry.handler.ts` | 91.60% (240/262) | 100.00% (18/18) |
| `src/actions/handlers/blog-entry-update-meta.handler.ts` | 83.43% (146/175) | 100.00% (9/9) |
| `ALL_SOURCE` | 86.36% (4601/5328) | 94.87% (370/390) |

Reports during validation: `/private/tmp/cms-int-a2-coverage-unit/lcov.info`, `/private/tmp/cms-int-a2-coverage-integration-{0..11}/lcov.info`, and `/private/tmp/cms-int-a2-coverage-results.json`. The combined check exits nonzero for any changed file/overall below 80%. Raw command logs are in `/private/tmp/cms-int-a2-unit-final.log`, `/private/tmp/cms-int-a2-coverage.log`, `/private/tmp/cms-int-a2-integration-final.log`, and `/private/tmp/cms-int-a2-integration-coverage.log`; this document retains portable counts/evidence after temporary files expire.

### Safety, recovery and remaining work

Migration 0008 was applied only to a separately initialized native PostgreSQL 14 cluster on localhost port 54729, database `cms_int_a2`, after backing up the disposable rows. The fixture loaded the repository's test schema/migrations and fixture identity. Explicit isolated environment files were used for every DB test; no default developer/shared/hosted DB was used. Test-only failure triggers/functions were scoped to the disposable DB and cleaned up. The owned fixture cluster is stopped after validation. No tenant backfill, deployment, destructive production operation, commit, push or PR was performed.

The migration adds nullable columns only, deliberately following the pre-existing handwritten 0005–0007 SQL/journal workflow. Drizzle metadata snapshots still predate those migrations: generation reconciliation is separate work, not an excuse to synthesize a destructive migration. Deploy with an approved backup/schema/journal check; application rollback retains columns. Legacy publications require explicit republish for new delivery; old public routes retain their original behavior. A3 must implement body-free SQL summary projection, the new delivery queries/routes and reuse this validator/availability policy. A4/A5 and frontend integration UI remain separate stories.

Remaining operational limits: durable retry exclusion requires a writable DB; a failure to persist bookkeeping is bounded within the run but may be retried on later polling. Advisory locking requires session-affine database access (transaction-pooling proxies require a session endpoint). Unsupported editor node versions/formatting fail publication and require author correction or deliberate versioned validator support. Storage reference resolution must continue to enforce existing scan-success gates; this module does not provide media signing or HTML rendering.

New source helpers use inferred Drizzle row types and Zod DTO/failure validation, with no `any`, type suppressions, relaxed config or dependency additions. Existing `ContentEntryData` assertions in the legacy repository/handler boundary and older mock `any` debt were retained to avoid silently redefining every legacy dynamic payload. A follow-up can consolidate those legacy data contracts with runtime validation; new publication DTOs already validate unknown persisted data. Documentation updated: `DEVELOPER.md`, `docs/CMS_ACTIONS.md` (also removes stale contentTypeId from directory-first create), `CHANGELOG.md`, ADR-002 and this plan. No repository AGENTS/README exists to update.

## Pre-PR revalidation

Revalidation reviewed all tracked/untracked changes against develop `35c3904`, including the empty staged and committed diffs. Independent review found ordinary Lexical0.38.2 exports were rejected because link attributes and table background color can be null. Added a real headless-editor serialization fixture and observed a failing regression before allowing these documented nullable/public presentation fields. Included supported table striping/frozen counts/cell alignment and code theme with strict types; invalid metadata still rejects. The real API-key publication integration now exercises this fixture. Independent reproduction and final suites pass after the fix.

Fresh results: focused impacted tests 67 passed before the new regression, pure snapshot tests 9 passed after the fix, full units 418 passed, configured coverage tests 492 passed/77 DB-gated skips, configured integration 96 passed/0 skips, all12 integration coverage cohorts passed, lint/typecheck/build passed. Initial revalidation integration launch failed with connection refusal because the fixture was restarted without its dedicated port; corrected launch and reran successfully. No implementation test failures remain. The generated TypeScript cache is restored and the fixture is stopped at completion. See [the full review report](2026-10-01-CMS-INT-A2-pre-pr-review.md).
