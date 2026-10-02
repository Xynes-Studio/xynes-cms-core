# CMS-INT-A3 delivery verification — 2026-10-02

Implementation is complete in `feature/CMS-INT-A3-bounded-snapshot-delivery` (CMS baseline 982ca51) and `feature/CMS-INT-A3-delivery-transport` (gateway baseline 72ec8f4). The user approved isolated fingerprint migration testing and legacy public-read hardening. This is implementation evidence, not a live deployment claim. The primary CMS checkout remains clean on merged A2; the primary gateway and unrelated repositories are preserved.

## Behavior and review

Strict A1 folder/detail contracts are registered internally. Folder SQL scopes frozen directory/workspace and excludes hidden/unvalidated publications before LIMIT/OFFSET; only bounded summary fields are selected. Literal search, title/date/UUID ordering, projections and truthful hasMore pass persistence tests. Real persisted folder DTOs match the pinned A1 response fixture (only its example UUID is replaced with the database-assigned UUID). A1's illustrative detail body uses a different editor syntax; A2's actual pinned Lumia/Lexical serialization fixture remains the body source of truth, and no second format is claimed.

Fingerprint writes are atomic with publication. Draft saves retain snapshot/proof; invalid republish preserves the prior publication. Missing proof, snapshot mutation, null snapshot, time/identity mismatch (including identity mismatch with a matching digest), hidden/future/deleted/foreign entries fail closed; explicit valid republish recovers. Both legacy public families use frozen slug/tag/media/body and closed DTOs. The review's one blocker—detail fetching unrestricted draft data—was reproduced by a failing SQL projection test and fixed for new and legacy public reads. A follow-up read-only review found no remaining correctness/security blockers; its focused CMS and gateway checks passed. Dedicated internal authentication/actor tests remain active; persistence tests preload synthetic authorization only for their isolated fixture.

Actual gateway source is built and exercised with isolated route definitions. Numeric/boolean-looking searches remain strings; pagination is numeric; path identity is bound; unsupported inputs fail; successful delivery responses have one envelope. The production patch applies only to the two CMS delivery actions. It adds no live routes, key resolver or permission bypass. A4 still owns end-to-end real API-key scope enforcement and route/permission/preset provisioning.

## Fresh validation

- Pinned Bun1.3.14 disposable container, configured `bun run test:coverage`: **529 pass, 137 skipped tests/hooks, 0 fail** across 52 files. DB suites are separately gated; temporary `/private/tmp` is supplied for existing Linux smoke tests. A3 source and pinned dependencies are mounted read-only; the running app is untouched.
- Configured `bun run test:integration` with `XYNES_GATEWAY_REPO` targeting the isolated gateway worktree: **15 independent cohorts, 114 pass, 0 fail**. New folder persistence: 10 tests/106 assertions; actual gateway integration: 3 tests/22 assertions; legacy persistence: 4 tests/31 assertions. Fresh instrumented cohorts also all pass.
- CMS `bun run lint`: 51 source files clean; `bun run typecheck`: passes; real Bun build: 285 modules, 1.18 MB; whitespace check: passes.
- Gateway configured `bun run coverage`: **692 pass, 0 fail** across 46 files; typecheck and real Bun build pass (220 modules, 0.88 MB). ESLint exits 0 with **33 pre-existing warnings, zero errors**; no new warnings in the added test. Overall coverage:95.75% lines/95.27% functions; changed `dynamicRouter.ts`:99.42% lines/87.50% functions.
- Additive 0009 was applied only to the owned Postgres14 fixture on port54729, after a custom-format backup. A second database restored from that pre-0009 backup proved the column absent before migration, unchanged historical draft/snapshot/status after migration, NULL proof without backfill, both indexes present, and a successful second canonical-migrator run. The second fixture database was removed afterward; the owned PostgreSQL test server was stopped after validation.
- EXPLAIN compatibility diagnostics with sequential scans and standalone sorts temporarily disabled show both date/title ordering indexes usable beneath a Limit. Small-fixture index diagnostics are not a production cost/latency benchmark. SQL selection tests prove no folder body/full-snapshot/current-data/COUNT materialization and no detail draft/audit selection.

## Coverage gate

All changed production files clear 80% lines and functions:

| Production file | Executable lines | Conservative functions | Line hits |
| --- | ---: | ---: | ---: |
| `src/actions/publication-snapshot.ts` | 93.35% | 100.00% | 379/406 |
| `src/infra/db/repositories/content-publication.repository.ts` | 97.91% | 100.00% | 187/191 |
| `src/infra/db/repositories/content-entry.repository.ts` | 86.48% | 96.08% | 467/540 |
| `src/actions/handlers/blog-entry.handler.ts` | 91.46% | 100.00% | 225/246 |
| `src/actions/handlers/content-published.handler.ts` | 96.12% | 100.00% | 124/129 |
| `src/actions/handlers/content-delivery.handler.ts` | 94.52% | 100.00% | 69/73 |
| `src/actions/schemas/content-delivery.ts` | 100.00% | 100.00% | 49/49 |
| `src/infra/db/repositories/content-delivery.repository.ts` | 97.06% | 100.00% | 66/68 |
| `src/infra/db/repositories/publication-validation.ts` | 88.68% | 100.00% | 47/53 |
| `src/infra/db/schema.ts` | 100.00% | 100.00% | 201/201 |
| `src/actions/index.ts` | 100.00% | 100.00% | 158/158 |
| `ALL_SOURCE` | 87.37% | 95.18% | 4938/5652 |

Unit LCOV comes from pinned Bun1.3.14; native isolated DB cohorts use Bun1.2.18. Source line hits are unioned across fresh cohorts; function hits conservatively use the maximum complete-cohort hit count. Host Bun1.2.18's erased type-only lines can depress its raw LF denominator, so this table uses actual DA line records. Branch coverage is unsupported by this output and is not claimed. `src/actions/types.ts` has only erased type additions, with no executable production lines. Runner configuration is validated by the actual configured runner rather than reported as production LCOV. Reports/logs live under private temporary paths and contain synthetic fixture data only.

## Recovery and remaining deployment work

Take an approved target backup, inspect journal/schema, apply 0009 before starting this CMS code, plan index-build locking, and retain nullable columns on application rollback. Historical A2 publications require explicit republish; do not copy drafts or synthesize fingerprints. Version future validator policy changes. Fingerprints detect snapshot mutation, not malicious privileged DB writers; hashing still consumes DB I/O. Offset pages may change across concurrent republishes.

Deploy the coordinated gateway transport patch and complete A4 route/permission/key-scope wiring. Object references still require existing authorized storage resolution and scan gates. The user subsequently authorized local migration and PR publication on 2026-10-02. Hosted databases, live route registration and application deployment remain untouched.


## Authorized local migration and PR preparation — 2026-10-02

The running CMS and `db.local` resolve to the same loopback Supabase cluster; PostgreSQL 17.4 and the Drizzle journal already through 0008 were checked before mutation. A full custom-format database backup (5,389,839 bytes) was made with mode 0600, inspected with pg_restore, and retained outside Git at `.local-backups/cms-int-a3-20261002/postgres-before-0009.dump`. Its SHA-256 and before/after row counts/hashes are retained in the adjacent private evidence file. No credentials or row contents enter this document or the PR.

The canonical CMS forward migrator applied only pending 0009. All 42 content entries and existing row values across all 7 CMS tables are unchanged, verified by per-table counts and hashes excluding the added nullable column. Historical fingerprints remain NULL; both delivery indexes and the new migration journal entry are present. CMS `/health` and `/ready` return HTTP 200 afterward. The primary app continues running A2; the migration does not deploy the new code, and explicit republish should follow A3 deployment. No hosted database, route registry or key scopes were changed.

Pre-PR checks were freshly repeated: pinned Bun1.3.14 CMS coverage 528 pass/0 fail; gateway coverage 691 pass/0 fail; configured isolated integration 15 cohorts/113 pass/0 fail; both typechecks/builds pass; CMS lint clean and gateway lint zero errors/33 baseline warnings. Per-file coverage remains above 80%. One host-sandbox CMS rerun could not bind the existing loopback smoke server; it passed unchanged in the pinned disposable container. A rerun also exposed a fixture-cost assumption in the index diagnostic: a date index plus title sort is a valid plan. The test now disables standalone sorts only within its diagnostic transaction to prove both ordering indexes are usable, without changing production planner settings or application code. Full isolated integration and coverage passed afterward.

Read-only review found no remaining implementation blockers. PRs target develop in the two independently owned repositories; A4 route/permission/preset provisioning remains separate work. Application rollback retains the additive column/indexes. No automatic merge or deployment is authorized by PR creation.


## PR review fixes — CMS #43 / gateway #47

Both PR branch/head identities were verified before editing. The legacy-list SQL projection regression failed while complete snapshots were selected; list queries now build only bounded summary/legacy fields, with a null body sentinel for the shared mapper. Full stored bodies are still covered by the fingerprint WHERE gate, and detail queries retain their bounded full snapshot. The new isolated fixture proves harmless large editor text never enters list rows or either list API, tampered body snapshots remain excluded, and detail keeps the original body. No schema or current-database changes are required.

The gateway regression observed HTTP 500 for malformed/empty successful delivery JSON. Both parse failures and invalid success envelopes now share HTTP 502 `BAD_GATEWAY` / `Invalid CMS delivery response`; upstream errors and legacy route behavior remain unchanged. Five focused gateway tests pass, including both delivery actions.

Fresh configured validation after these fixes: CMS 529 unit tests, 114 isolated integration tests across 15 cohorts, gateway 692 tests; zero failures. Source lint, both typechecks and both Bun builds pass; gateway retains 33 baseline lint warnings with zero errors. Coverage table above reflects the repaired source: entry repository 86.48% lines/96.08% functions, publication-validation 88.68%/100%; CMS overall 87.37%/95.18%. Gateway router 99.42%/87.50%, gateway overall 95.75%/95.27%. No branch metric is invented. Tests run only against the owned isolated DB; local Supabase data and deployed app code are unchanged by the review fixes.
