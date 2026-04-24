DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "cms"."content_entries"
    WHERE "status" NOT IN ('draft', 'scheduled', 'published', 'archived')
  ) THEN
    RAISE EXCEPTION 'cms.content_entries contains unsupported status values';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'content_entries_status_check'
      AND connamespace = 'cms'::regnamespace
  ) THEN
    ALTER TABLE "cms"."content_entries"
      DROP CONSTRAINT "content_entries_status_check";
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "cms"."content_entries"
  ADD CONSTRAINT "content_entries_status_check"
  CHECK ("status" IN ('draft', 'scheduled', 'published', 'archived'));
