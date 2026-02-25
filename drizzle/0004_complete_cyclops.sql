CREATE TABLE IF NOT EXISTS "cms"."content_directories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"parent_id" text,
	"name" text NOT NULL,
	"path_segment" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_directories_workspace_created_at_idx" ON "cms"."content_directories" ("workspace_id","created_at");--> statement-breakpoint
DROP INDEX IF EXISTS "cms"."content_directories_workspace_parent_path_segment_unique";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "content_directories_workspace_root_path_segment_unique" ON "cms"."content_directories" ("workspace_id","path_segment") WHERE "parent_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "content_directories_workspace_parent_path_segment_unique" ON "cms"."content_directories" ("workspace_id","parent_id","path_segment") WHERE "parent_id" IS NOT NULL;
