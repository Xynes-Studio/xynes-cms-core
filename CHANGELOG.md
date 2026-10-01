# Changelog

## Unreleased — CMS-INT-A2

- Preserve versioned, bounded last-publication snapshots atomically across create, publish and scheduled activation; draft saves retain the previous publication.
- Add authoring `deliveryState`, safe editor/storage reference validation, isolated scheduler failures with bounded retries and edit/reschedule recovery.
- Add nullable snapshot/failure columns without backfilling legacy entries; explicit republish is required for new snapshot delivery. Existing legacy public reads retain their behavior.
- Validate transaction ordering, rollback, scheduler locks/recovery and API-key/legacy compatibility on isolated PostgreSQL. A3 delivery routes remain separate work.
