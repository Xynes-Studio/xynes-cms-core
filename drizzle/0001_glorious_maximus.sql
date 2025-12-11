CREATE TABLE IF NOT EXISTS "cms"."comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"parent_id" uuid,
	"user_id" uuid,
	"display_name" text,
	"content" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comments_workspace_entry_created_idx" ON "cms"."comments" ("workspace_id","entry_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comments_parent_idx" ON "cms"."comments" ("parent_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cms"."comments" ADD CONSTRAINT "comments_entry_id_content_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "cms"."content_entries"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
