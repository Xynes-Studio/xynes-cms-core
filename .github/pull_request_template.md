## Summary
<!-- One-paragraph description of what this PR does and why. -->

## Linked work
- Plan / issue: <!-- link -->
- Related repos: <!-- link any PRs that depend on or are depended on by this one -->

## Quality gates
- [ ] `lint` passes locally
- [ ] `test` passes locally
- [ ] Coverage ≥ ADR-001 80% floor (or justified exception below)
- [ ] `typecheck` / `build` passes (where applicable)
- [ ] Docs updated (`README.md`, `DEVELOPER.md`, `AGENTS.md`, repo memory)
- [ ] Migration added (if schema change) — forward-only, expand/contract
- [ ] QA PII scrub updated (if migration adds PII)
- [ ] Release doc set updated (if release contract changed)

## Security
- [ ] No secrets in code, logs, error messages, or test fixtures
- [ ] No raw API keys forwarded to downstream services
- [ ] No PII added to telemetry or access logs

## Deployment notes
<!-- e.g. "Requires migration run before service rollout", "Requires xynes-platform-contracts vX.Y.Z first". -->

## Rollback plan
<!-- For risky changes only. -->

---

## Repo-specific items (xynes-cms-core)

This is a **Bun + Hono + Drizzle** service backed by **Biome** for lint/format. Use `bun`, never `npm`.

- [ ] Lint: `bun run lint` (biome `check src` — note: lints `src/` only per repo convention; `test/` is intentionally out of scope)
- [ ] Tests: `bun run test` (full suite; default env file `.env.dev` via `scripts/run-with-env.ts`)
- [ ] Coverage: `bun run test:coverage` — overall must stay at or above the **ADR-001 80% lines + branches floor**
- [ ] Typecheck: `bun x tsc --noEmit` — zero new errors vs the target branch baseline (verify with `git stash` round-trip if pre-existing errors exist)
- [ ] If touching `src/infra/db/schema.ts`: add the matching forward-only Drizzle migration under `drizzle/` (per `drizzle.config.ts` `out`). Run `bun run db:generate` to scaffold and `bun run db:push` to verify replay-safety against a local DB. The `cms` and `cms_migration_backups` schemas are owned by this service (per `xynes-infra/docs/DATABASE.md` §3); avoid touching `platform.*` / `identity.*` / `authz.*` tables — they are owned by `xynes-infra` / `xynes-authz-service` respectively.
- [ ] **Directory-first contract (2026-03-02 baseline; AGENTS.md §"CMS directory-first contract").** Dashboard create/update/list flows MUST NOT require `contentTypeId`. The primary authoring contract is `cms.entry.*`; `routeSegment` / `contentTypeId` semantics (`cms.content.*`, `cms.blog_entry.*`) are legacy compatibility for public/template-style reads only. PRs that re-introduce content-type-first behaviour to dashboard routes are rejected — update docs first if they suggest otherwise.
- [ ] **Actor-aware handlers (CMS-API-KEY-ACTOR-1 Story A + Story C).** Internal route MUST parse `X-XS-Actor-Type` / `X-XS-User-Id` / `X-XS-API-Key-Id` / `X-XS-API-Key-Prefix` per the discriminated `ActionActor = UserActor | ApiKeyActor` contract in `src/actions/types.ts`. `src/middleware/authz-check.ts` MUST short-circuit when `ctx.actor?.kind === 'api_key'` (gateway has already scope-checked the route's action key). In-preset write handlers (`cms.entry.create` / `.update` / `.publish` / `.status.set`) use `getOptionalUserId(ctx)` so api_key actors leave `created_by` / `updated_by = NULL`; out-of-preset writes (`cms.entry.delete` / `.collaborators.set` / `.favorite.*` / `.share.generateInternalLink` / `cms.content_directories.*`) gate with `requireUserActor(ctx)` from `src/middleware/actor-guards.ts` and 403 `FORBIDDEN_ACTOR_KIND` for api_key.
- [ ] **Closed-set error codes only.** Provider / postgres / Drizzle error text MUST NOT propagate into envelope `error.message` or `error.details`. New error paths land as additions to the existing closed-set unions (e.g. `ForbiddenActorKindError` in `src/actions/errors.ts`) — never a free-form string.
- [ ] If adding a new gateway-reachable action: open the matching `xynes-infra/supabase/migrations/20251229100001_seed_platform_routes.sql` route seed PR AND the `xynes-authz-service` permission catalog PR in lockstep. Merge order: contracts/authz first, then this PR. Action keys MUST follow the `cms.<domain>.<verb>` pattern.
- [ ] No raw credentials in any test fixture or handler. No `xynes_live_*` / `AKIA*` / `re_*` / `X-Amz-Signature` substrings anywhere — gateway redaction is the last line, not the only line.
