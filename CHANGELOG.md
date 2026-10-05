# Changelog

## Unreleased — CMS-INT-A3

- Harden generic and blog public APIs to serve validated frozen publication values, including published slug/tag lookup, without returning saved drafts or arbitrary private/custom data.
- Capture bounded legacy slug/excerpt/cover/document fields at publication and reject recognized credential-bearing cover URLs with the existing publication policy.
- Older snapshots without frozen legacy metadata require explicit republish. Preserve authenticated draft authoring and documented response envelopes.
- Register strict workspace-scoped folder/detail delivery actions with bounded summary projection, literal search, stable sorting, closed CSV fields and limit+1 pagination.
- Add nullable validation fingerprints and folder ordering indexes in additive migration 0009. Publish writes proof atomically; historical/changed snapshots fail closed until explicit republish.
- Narrow public reads to publication/state fields so unrestricted draft bodies never enter delivery queries.
- Verify persistence, real A1 DTO serialization, unavailable states, migration preservation/idempotence and actual gateway query/envelope behavior in isolated fixtures. A4 still owns live routes, permissions and preset scopes; current/hosted databases are not migrated.

## CMS-INT-A2

- Preserve versioned, bounded last-publication snapshots atomically across create, publish and scheduled activation; draft saves retain the previous publication.
- Add authoring `deliveryState`, safe editor/storage reference validation, isolated scheduler failures with bounded retries and edit/reschedule recovery.
- Add nullable snapshot/failure columns without backfilling legacy entries; explicit republish is required for new snapshot delivery. Existing legacy public reads retain their behavior.
- Validate transaction ordering, rollback, scheduler locks/recovery and API-key/legacy compatibility on isolated PostgreSQL. A3 delivery routes remain separate work.
