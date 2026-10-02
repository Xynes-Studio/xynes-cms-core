# ADR-002: Atomic last-publication snapshots

## Status

Accepted for CMS-INT-A2, following the approved CMS content integrations discovery contract.

## Context

Integration delivery must serve the last published version while authors continue editing. Reading the current draft for a published row changes delivered content without republish. Scheduled invalid legacy content can also block later publications.

## Decision

Store a nullable versioned public snapshot and safe scheduler-failure metadata on the CMS entry. Centralize all publication paths in a shared repository helper. For existing entries, lock the latest scoped row and validate/copy/commit publication state in one transaction. Draft saves retain the snapshot; live status/time/deletion gates hide it immediately when appropriate. Create-with-publish validates before its single insert. Use one pure strict validator for creation, read validation and authoring availability, with A1 summary bounds and a 1 MiB serialized DTO budget.

Do not backfill from mutable drafts. Historical entries need explicit republish. Preserve legacy response shapes and existing legacy public reads; new snapshot delivery is implemented by A3. New summaries must exclude body in the database projection before materialization.

Isolate scheduled failures by entry. Preserve the source revision when recording bounded metadata; compare captured source state under the recovery lock so concurrent repairs are not marked failed. Retry transient errors at most three times with 30/60-second backoff; permanent/exhausted revisions recover by edit/reschedule. Bound each run and own the advisory-lock PostgreSQL session for reliable release.

## Consequences

Saving and republishing have distinct behavior. Validation/DB failures leave the prior publication intact. Unsupported editor versions and oversize content require correction before publication. Rollback retains additive nullable columns. Existing legacy dynamic-data casts and Drizzle metadata drift remain documented follow-up work. Hosted migration approval/backups, transaction-pooling compatibility, storage scan gates and the new delivery query projections remain deployment/integration responsibilities. See [the developer policy](../../DEVELOPER.md#publication-snapshots-cms-int-a2) and [verification evidence](../plans/2026-10-01-CMS-INT-A2-publication-snapshots.md).
