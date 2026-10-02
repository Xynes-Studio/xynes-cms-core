# Pre-PR Re-validation Report

## Verdict

**READY FOR PR** after the small serializer compatibility fix recorded below. No remaining blocking finding. No commit, push, merge, deployment or PR creation performed.

## Branch and Base

- Current branch: `feature/CMS-INT-A2-publication-snapshots`.
- Base: cms-core `develop` / `origin/develop`, `35c3904`.
- Review scope: all unstaged tracked changes and untracked A2 source, tests, fixtures, migration, metadata and docs. Staged diff and `develop...HEAD` are empty; no story commits yet. Git status/diff/staged/log/branch/base comparison reviewed. No unrelated branch changes found.

## Story Re-validation

All A2 acceptance criteria are implemented in their intended scope: strict nullable versioned public snapshot; row-locked atomic publication; saved draft/folder changes retain last publication; shared create/publish/API-key/scheduled invariant; live/deleted/future gates; explicit legacy republish/no backfill; safe supported editor/storage data; A1 summary and1MiB DTO bounds; isolated scheduled failures with bounded durable retry/recovery; additive authoring availability; forward-only CMS migration. Real DB tests prove rollback and concurrent ordering. A3 owns body-free SQL summary projection and the new delivery query/routes; no A3 query is prematurely implemented here. Legacy public draft-backed reads intentionally remain outside the new snapshot guarantee.

## Git Changes Reviewed

In-scope groups: shared snapshot validator; publication repository and existing entry repository wiring; availability/legacy response privacy in three handlers; scheduler; schema/0008 migration/journal; configured integration registration; unit/DB/real-editor fixtures; developer/API/changelog/ADR/plan/review documentation. All untracked files must be included when committing. No unrelated dependency, lockfile, permission, environment or TypeScript configuration change. Generated `tsconfig.tsbuildinfo` is restored before handoff.

## Architecture and Code Quality

Pure DTO validation lives in actions, atomic data access in repositories, polling/locks in scheduling, and additive storage changes in schema/migration. Existing handlers remain thin consumers. One publication helper covers the audited write paths; one validator covers build/read/availability. No new dependency, cross-repository runtime coupling or unnecessary subsystem was added. Existing legacy data assertions and historical Drizzle snapshot drift are follow-up debt, explicitly documented rather than broadly refactored.

## Testing and Coverage

- Impacted tests before fixes:67 passed; newly added actual-editor regression failed on old implementation then passed after fix. Post-fix pure snapshot tests:9 passed.
- Full unit suite:418 passed,0 failed in26 files.
- Full configured coverage suite:492 passed,77 intentionally DB-gated skips,0 failed in44 files.
- Configured isolated integration runner:96 passed,0 skipped/failed across12 subprocesses, including12 publication integration tests.
- Integration coverage:all12 configured file cohorts passed against the same disposable DB.
- Combined source line coverage:**86.36%** (4601/5328); function coverage conservative lower bound:**94.87%** (370/390). Every changed source file clears80% for both metrics. Full per-file counts are in [the implementation evidence](2026-10-01-CMS-INT-A2-publication-snapshots.md#coverage-gate).
- Bun lacks branch metrics/function identities in LCOV. Lines use unioned hits; maximum observed per-file function hits are a conservative bound. No unsupported metric was fabricated.
- No remaining implementation failure. Initial review integration attempt hit ECONNREFUSED because the fixture launch omitted its custom port; corrected and reran. No unrelated failing suite was hidden.

## TypeScript Type-Check Review

TypeScript is strict. `bun run typecheck` (`tsc --noEmit`) passes after all code fixes. No new `any`, `as any`, suppression, compiler relaxation or dependency addition. The regression initially compared an unknown fixture against a typed expectation, causing a TypeScript overload error; reversed the equality assertion without casting and reran successfully. Existing legacy `ContentEntryData` assertions at repository/handler boundaries and old `any` DB mocks remain scoped follow-up debt; the new publication implementation uses inferred Drizzle rows and runtime Zod validation.

## Security Review

Reviewed tenant/type/deletion scoping, authentication/authorization preservation, API-key audit attribution, safe logging/error codes, public DTO field allowlists, signed URL/resource CSS rejection, object reference preservation, schema/mass-assignment protection, bounded serialization/tree traversal, scheduler retries and transaction races. No new network fetch/HTML renderer/media-signing flow or permission weakening. Storage-backed references still require existing storage scan-success/download gates. Legacy internal raw responses omit snapshot/failure columns. No remaining security blocker identified by root or independent read-only reviewer.

## Database and Migration Review

0008 adds two nullable JSONB columns and comments with journal registration; no table/column/constraint/index drop, backfill or tenant rewrite. Reviewed against schema and disposable DB tests. Only the backed-up task PostgreSQL14 fixture was used. Hosted/shared DB migration remains subject to backup/schema/journal checks in the normal deployment workflow. Roll application code back while retaining columns/data. Historical rows require explicit republish; old code after rollback may publish without snapshots. Session advisory locks require a session-affine database endpoint; transaction-pooling compatibility is documented.

## Documentation Review

Developer policy/recovery/migration notes, API availability/error behavior, changelog, ADR-002, implementation evidence and real-editor fixture provenance are updated. Repository has no local AGENTS.md or repo README to update; workspace AGENTS instructions are followed. No new env variable. Existing directory-first API example's stale contentTypeId was removed. Deployment and legacy limitations are explicit.

## Commands Run

Quality commands after the final fix (explicit task fixture environments, never default shared env):

| Command | Result |
| --- | --- |
| `XYNES_ENV_FILE=<unit.env> bun run test test/unit` |418 pass/0 fail |
| `XYNES_ENV_FILE=<unit.env> bun run test:coverage --coverage-reporter=lcov --coverage-dir=<unit-report>` |492 pass/77 DB-gated skips/0 fail |
| `XYNES_ENV_FILE=<fixture.env> bun run test:integration` |96 pass/0 skip/0 fail |
| `bun --env-file=<fixture.env> test --coverage --coverage-reporter=lcov --coverage-dir=<cohort> --preload ./test/integration/allow-authz.preload.ts <configured-file>` (each of12 files) |All passed |
| `python3 /private/tmp/cms-int-a2-coverage-report.py` |All changed-file and overall80% gates passed |
| `bun run lint` |47 source files clean |
| `bun run typecheck` |Passed |
| `bun build src/index.ts --target=bun --outdir=/private/tmp/cms-int-a2-review-build` |281 modules bundled,1.17MB |
| `git diff --check` |Passed |

Git review commands: `git status --short`, `git diff`, `git diff --staged`, `git log --oneline --decorate --graph`, `git branch --show-current`, `git branch -vv`, `git diff develop...HEAD`. Source, actual installed Lexical serializers, migrations, ADRs, API/developer docs and type-bypass searches inspected. Focused commands used the five impacted unit files and later `test/unit/publication-snapshot.test.ts` (9 pass). Fixture launch/stop used only `pg_ctl -D /private/tmp/cms-int-a2-pg-2dj5ddy2/data`; corrected start passes `-p54729 -h127.0.0.1` and its dedicated socket directory. No hosted or shared DB command ran. Fresh raw logs: `/private/tmp/cms-int-a2-review-{focused,unit,coverage,integration}.log` and `/private/tmp/cms-int-a2-integration-coverage.log`.

## Fixes Made During Re-validation

`src/actions/publication-snapshot.ts`: accept actual null link attributes/cell background colors, typed table presentation metadata and code theme; preserve strict invalid/private field rejection. `test/unit/publication-snapshot.test.ts`: regression on actual Lexical0.38.2 export plus invalid metadata cases. `test/integration/publication-snapshot.test.ts`: API-key publication uses the real editor fixture. `test/fixtures/cms-delivery/lexical-0.38.2.json` and README: actual serialized output and provenance, no editor runtime dependency in CMS. Developer/evidence/review docs updated. Regression red/green observed, independent reproduction accepted, full checks rerun after fixes.

## Suggested Commit Messages

- `feat: preserve atomic CMS publication snapshots (CMS-INT-A2)`

## Blocking Issues

None remaining.

## Recommended Follow-up Stories

- CMS-INT-A3: implement snapshot delivery queries/routes with body-free SQL summary projection and these predicates.
- Reconcile historical Drizzle generation snapshots with handwritten migrations and schema ownership before the next generated migration.
- Consolidate legacy dynamic data DTO/runtime validation and older mock types without broadening A2.
- Keep actual editor export fixtures current when upgrading Lexical/Lumia; deliberately version any new editor support.

## Final Notes

Safe to raise the A2 PR after committing the intended tracked/untracked files. This review does not authorize deployment or tenant backfill. Durable retry exclusion requires writable bookkeeping; DB outages can cause retries on later polls, but not an infinite loop within one run. No PR created or changes committed/pushed. Only the disposable fixture was used and is stopped at handoff.
