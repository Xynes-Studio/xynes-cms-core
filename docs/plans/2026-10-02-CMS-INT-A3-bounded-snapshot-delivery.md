# CMS-INT-A3 Bounded Snapshot Delivery Implementation Plan

**Goal:** Implement workspace-scoped, bounded directory and entry delivery actions on the frozen A1 contract and merged A2 publication snapshots.

**Architecture:** Strict request schemas feed DI-friendly delivery handlers and a dedicated Drizzle repository. Existing internal-service authentication and actor authorization remain authoritative. A4 owns deployed route/scopes; A3 will exercise transport parsing with isolated gateway route definitions, without changing live registration.

**Tech Stack:** Bun, Hono, Zod 4, Drizzle 0.45.2/PostgreSQL, pinned A1 JSON fixtures.

## Scope and prerequisite checks

- Branch `feature/CMS-INT-A3-bounded-snapshot-delivery` from `origin/develop` at `982ca51`; A2 PR42 is merged.
- Preserve all unrelated worktrees and frontend/infra edits. Initial implementation authorization excluded commit/push/PR and current/hosted DB migrations. On 2026-10-02 the user subsequently authorized backed-up local migration and PR publication; hosted migration and automatic deployment/merge remain excluded.
- Baseline unit/full regression and typecheck must pass before implementation. ADR001 plus the user's stricter floor require >=80% coverage for changed code.
- User approved extending A3 to close the legacy public-read gap on 2026-10-02: legacy reads must serve validated publication values, never current/draft data. Preserve the documented response envelopes and approved fields; arbitrary private/custom data cannot be retained safely. Capture bounded legacy slug/excerpt/cover/document fields at publication, validate URLs with the existing publication policy, and require republishing where frozen legacy values are unavailable.
- Full-body malformed-snapshot exclusion in summary-only SQL requires persisted validation metadata. User explicitly approved implementing the nullable fingerprint column and testing it only in the isolated database. That initial approval was isolated-only; subsequent authorization permitted the backed-up local migration, but no hosted migration.

## Execution

1. Add failing `test/unit/content-delivery-contract.test.ts` request boundary/CSV/projection/parity cases. Create `src/actions/schemas/content-delivery.ts` using A2 summary bounds and closed local field sets; compare to the pinned A1 artifact and harmless response fixtures.
2. Add failing `test/unit/content-delivery.handler.test.ts` workspace-context, unavailable outcome, projections, stable pagination and transient-error cases. Create `src/actions/handlers/content-delivery.handler.ts` with narrow repository dependencies and a fixed safe unavailable domain error.
   Extend publication and legacy-read regressions to prove frozen slug/tag/title/body/cover values and exclusion of private fields, invalid bodies/URLs, unavailable snapshots and unrepublished edits. Update generic/blog public handlers and their scoped repository predicates, keeping authoring reads unchanged.
3. After the validity decision, add failing isolated PostgreSQL cases in `test/integration/content-delivery.test.ts`. Implement `src/infra/db/repositories/content-delivery.repository.ts` with workspace/live/due/deletion/published-directory predicates, snapshot sorts, escaped literal search and bounded limit+1 summary projection. Never SELECT body/full snapshot for lists or issue COUNT.
4. Register both actions in `src/actions/index.ts` and explicit keys in `src/actions/types.ts`. Exercise action envelopes through Hono and existing actor guards. Add the isolated DB file to the integration runner.
5. Exercise real gateway query coercion/path binding using fixture routes without provisioning live routes or keys. Any demonstrated gateway defect must be discussed against A4 ownership before broad transport changes.
6. Run focused tests, the configured isolated integration suite, service regression/coverage, lint/typecheck and actual Bun build; collect honest per-file LCOV evidence, disclose unsupported branch metrics.
7. Update DEVELOPER.md, CMS_ACTIONS.md, CHANGELOG.md and verification notes with inputs, publication guarantee, availability, sorting/page semantics, media/storage boundaries, deployment prerequisites and remaining limitations. Keep the working tree reviewable and uncommitted.

## Verification commands

Use `XYNES_ENV_FILE=/private/tmp/cms-int-a2-pg-2dj5ddy2/unit.env` for database-disabled regression. Use only the owned disposable Postgres fixture on port54729 for integration, after checking its environment and runner. Never select the actual developer database merely to make a test pass.

- `bun test test/unit/content-delivery-contract.test.ts test/unit/content-delivery.handler.test.ts`
- `bun run test:integration` with the explicit fixture environment
- `bun run test:coverage` with the explicit unit environment, plus isolated integration LCOV cohorts
- `bun run lint`, `bun run typecheck`
- `bun build src/index.ts --target=bun --outdir=<private temporary directory>`

## Completion evidence

All execution steps are complete. The approved nullable fingerprint migration and ordering indexes are implemented, publication writes are atomic, both delivery actions are registered internally, and the legacy extension serves closed frozen DTOs. Read-only review identified one unbounded detail projection; its failing regression now passes after selecting only publication/state columns for new and legacy reads.

Fresh service checks pass: CMS 528 unit tests and 113 isolated integration tests; gateway 691 tests; CMS source lint clean; both typechecks/builds pass. Gateway lint retains 33 baseline warnings with zero errors. Every changed production file exceeds 80% executable lines/functions; unsupported branch metrics are disclosed. Full commands, per-file coverage, migration preservation/idempotence, response fixture comparison, gateway transport and index diagnostics are recorded in [verification](../verification/2026-10-02-legacy-publication-delivery.md).

The authorized local migration is now applied after backup and verified without changing existing CMS rows; hosted databases and running primary app code remain unchanged. A3 code is retained in isolated feature worktrees for the authorized PR publication. A4 owns public route/permission/preset scope provisioning. Coordinated deployment needs approved backed-up migration 0009 first, the gateway transport patch, and explicit republish for historical snapshots. See DEVELOPER.md for rollout, rollback, storage and fingerprint limitations.
