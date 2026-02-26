ALTER TABLE "cms"."content_entries" ADD COLUMN IF NOT EXISTS "directory_id" uuid;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'content_entries_directory_id_content_directories_id_fk'
  ) THEN
    ALTER TABLE "cms"."content_entries"
      ADD CONSTRAINT "content_entries_directory_id_content_directories_id_fk"
      FOREIGN KEY ("directory_id") REFERENCES "cms"."content_directories"("id") ON DELETE SET NULL;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "cms"."content_entries" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "cms"."content_entries" ADD COLUMN IF NOT EXISTS "deleted_by" uuid;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_entries_workspace_directory_idx" ON "cms"."content_entries" ("workspace_id","directory_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_entries_workspace_deleted_idx" ON "cms"."content_entries" ("workspace_id","deleted_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cms"."content_entry_collaborators" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "entry_id" uuid NOT NULL REFERENCES "cms"."content_entries"("id") ON DELETE CASCADE,
  "workspace_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "display_name" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_entry_collaborators_workspace_entry_idx" ON "cms"."content_entry_collaborators" ("workspace_id","entry_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_entry_collaborators_workspace_user_idx" ON "cms"."content_entry_collaborators" ("workspace_id","user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "content_entry_collaborators_entry_workspace_user_unique" ON "cms"."content_entry_collaborators" ("entry_id","workspace_id","user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cms"."content_entry_favorites" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "entry_id" uuid NOT NULL REFERENCES "cms"."content_entries"("id") ON DELETE CASCADE,
  "workspace_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_entry_favorites_workspace_user_idx" ON "cms"."content_entry_favorites" ("workspace_id","user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_entry_favorites_workspace_entry_idx" ON "cms"."content_entry_favorites" ("workspace_id","entry_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "content_entry_favorites_entry_workspace_user_unique" ON "cms"."content_entry_favorites" ("entry_id","workspace_id","user_id");
