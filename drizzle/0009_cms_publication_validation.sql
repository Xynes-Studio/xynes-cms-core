-- Historical snapshots deliberately remain unvalidated until explicit republish.
ALTER TABLE "cms"."content_entries" ADD COLUMN IF NOT EXISTS "published_snapshot_digest" text;
--> statement-breakpoint
COMMENT ON COLUMN "cms"."content_entries"."published_snapshot_digest" IS
  'Validator v1 SHA-256 over canonical JSONB text, written atomically after publication validation. No draft backfill.';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_entries_delivery_date_idx" ON "cms"."content_entries"
  ("workspace_id", ("published_snapshot" ->> 'directoryId'), "published_at", "id")
  WHERE "status" = 'published' AND "deleted_at" IS NULL AND "published_snapshot_digest" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_entries_delivery_title_idx" ON "cms"."content_entries"
  ("workspace_id", ("published_snapshot" ->> 'directoryId'), (("published_snapshot" -> 'entry' ->> 'title') COLLATE "C"), "published_at", "id")
  WHERE "status" = 'published' AND "deleted_at" IS NULL AND "published_snapshot_digest" IS NOT NULL;
