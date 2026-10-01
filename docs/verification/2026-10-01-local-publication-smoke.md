# CMS-INT-A2 local environment smoke — 2026-10-01

The CMS console's authoring list failed because the bind-mounted A2 source queried `published_snapshot` before migration 0008 had been applied to local Supabase. The original repository list query reproduced PostgreSQL `42703`. Generic health/readiness probes passed despite the missing columns.

After explicit user approval, a verified custom-format backup of `cms` and the Drizzle migration journal was retained outside Git. The CMS forward migrator applied only pending 0008; journal timestamp `1790812800000` and both nullable JSONB columns were verified. There was no reset, backfill, deletion of user content or hosted/shared database change.

The live publication smoke then exposed stale dependencies in Compose's persistent CMS `node_modules` volume: Drizzle **0.29.5**, postgres **3.4.7**, Zod **4.1.13**, despite the branch lockfile requiring **0.45.2**, **3.4.9**, **4.6.5** respectively. The old driver stored JSONB string scalars and lost timestamp precision, so a newly published fixture returned `republish_required`. Synchronizing with `bun install --frozen-lockfile` and restarting only CMS resolved the mismatch. Validation was retained unchanged. All smoke-created entries were soft-deleted; existing tenant content was not repaired or republished automatically.

## Verification

- Original repository authoring-list query: succeeds, one bounded row returned.
- Browser-facing gateway `GET /workspaces/:workspaceId/content/entries?sortBy=date&sortDirection=desc&status=all&limit=1&offset=0`: **HTTP 200**, valid items payload after the same nested-envelope unwrapping used by the frontend. Used a five-minute locally signed owner test JWT; no token or content was logged.
- Existing infra `smoke-all.sh --health-only --env-file .env.dev`: **14/14** health/readiness checks pass.
- Existing infra `smoke-cms-entry.sh --env-file .env.localhost` with actual local owner/internal token: **16/16** lifecycle assertions pass.
- New `smoke:publication`: all ten reported checks pass against the running CMS API and local Supabase, including cleanup. Exercises publication A, draft save retaining A, republish B, credential-bearing URL rejection retaining B, repair through `status.set`, and draft/scheduled/archived delivery gates.
- New smoke regression tests: **16/16** pass, including missing-schema preflight, broken-list preflight, publication/isolation failures with cleanup, malformed envelopes, redacted errors, explicit write opt-in/configuration, database-outage guidance and a real unresponsive loopback HTTP server timeout.
- Full regression/coverage cohort: **509 pass, 78 database-gated skips, 0 fail** (45 files). No integration tests were pointed at the local tenant database.
- Source lint, explicit lint of the new script/test files, and TypeScript checks pass.

Coverage evidence uses unit LCOV plus an external temporary harness running the actual CLI against the local API; separate subprocess cases exercise safe CLI preflight failures. No harness is installed into the application or used to bypass RBAC.

| Changed script | Line coverage | Function coverage |
| --- | ---: | ---: |
| `scripts/lib/publication-smoke.ts` | 86.15% in the unit cohort (conservative Bun 1.2 LF denominator) | 100% |
| `scripts/smoke-publication.ts` | 89.19% combined live/negative CLI cohorts | 100% |

Bun does not report branch coverage. Host and container Bun instrumentation differ; no branch result is inferred. Application source was unchanged by this follow-up. Full database integration uses the separate disposable PostgreSQL fixture, not local tenant data.

## Repeat and recovery

See [DEVELOPER.md](../../DEVELOPER.md#local-environment-smoke-and-recovery) for commands and fixture-write opt-in. The smoke verifies the database columns before any API writes and never applies migrations itself. Keep the pre-migration backup outside Git. Use the CMS-owned migrator after backup/approval, synchronize persisted dependencies, restart CMS, and rerun both health and API smokes.

A2 adds no new delivery endpoints. A3 owns those routes; this verification covers existing authoring APIs and stored publication snapshots. Due scheduled promotion stays in the isolated integration suite; the live fixture uses a 2099 schedule so the smoke does not trigger other tenants' due work. Historical publications with missing/invalid snapshots require explicit republish after recovery.
