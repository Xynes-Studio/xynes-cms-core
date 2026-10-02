-- Additive only: historical publications remain NULL until explicit republish.
ALTER TABLE "cms"."content_entries" ADD COLUMN IF NOT EXISTS "published_snapshot" jsonb;
--> statement-breakpoint
ALTER TABLE "cms"."content_entries" ADD COLUMN IF NOT EXISTS "scheduled_publication_failure" jsonb;
--> statement-breakpoint
COMMENT ON COLUMN "cms"."content_entries"."published_snapshot" IS
  'Versioned bounded public DTO captured atomically on publication. No automatic draft backfill.';
--> statement-breakpoint
COMMENT ON COLUMN "cms"."content_entries"."scheduled_publication_failure" IS
  'Safe bounded scheduler failure/retry metadata tied to a draft revision. Cleared on edit/reschedule.';
