# ADR-002: Atomic last-publication snapshots

## Status

Accepted for CMS-INT-A2; extended by approved CMS-INT-A3 validation proof and legacy public delivery hardening, following the approved CMS content integrations discovery contract.

## Context

Integration delivery must serve the last published version while authors continue editing. Reading the current draft for a published row changes delivered content without republish. Scheduled invalid legacy content can also block later publications.

## Decision

Store a nullable versioned public snapshot and safe scheduler-failure metadata on the CMS entry. Centralize all publication paths in a shared repository helper. For existing entries, lock the latest scoped row and validate/copy/commit publication state in one transaction. Draft saves retain the snapshot; live status/time/deletion gates hide it immediately when appropriate. Create-with-publish validates before its single insert. Use one pure strict validator for creation, read validation and authoring availability, with A1 summary bounds and a 1 MiB serialized DTO budget.

Do not backfill from mutable drafts. Historical entries need explicit republish. A3 was explicitly extended on 2026-10-02 to close the legacy current-data exposure gap: preserve documented legacy response envelopes while serving only validated frozen public fields. Generic detail data becomes a closed public allowlist. Existing snapshots without frozen legacy metadata need explicit republish; mutable drafts never substitute. New summaries exclude body in the database projection before materialization. A3 adds a nullable versioned fingerprint computed by PostgreSQL over canonical snapshot JSONB text, written only after full validation in the same publication transaction. Verify it with live/due/deletion/identity/time predicates before paging; historical proof remains NULL until explicit republish. This avoids reconstructing editor validation in SQL while excluding unvalidated bodies from folder feeds. The digest detects unvalidated mutation; it does not protect against a privileged writer forging both values. Public detail reads select bounded publication/state fields without unrestricted draft data.

Isolate scheduled failures by entry. Preserve the source revision when recording bounded metadata; compare captured source state under the recovery lock so concurrent repairs are not marked failed. Retry transient errors at most three times with 30/60-second backoff; permanent/exhausted revisions recover by edit/reschedule. Bound each run and own the advisory-lock PostgreSQL session for reliable release.

## Consequences

Saving and republishing have distinct behavior. Validation/DB failures leave the prior publication intact. Unsupported editor versions and oversize content require correction before publication. Rollback retains additive nullable columns. Drizzle metadata drift remains documented follow-up work. Hosted migration approval/backups, index-build maintenance, transaction-pooling compatibility, storage scan gates and A4 gateway route/permission/scope registration remain deployment/integration responsibilities. Hashing still reads publication bytes inside PostgreSQL; summary transport and application materialization remain bounded. Rollout requires 0009 before the new CMS code and explicit republish for old snapshots. See [the developer policy](../../DEVELOPER.md#publication-snapshots-cms-int-a2) and [verification evidence](../plans/2026-10-01-CMS-INT-A2-publication-snapshots.md).
