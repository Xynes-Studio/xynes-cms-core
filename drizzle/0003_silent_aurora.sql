-- CMS-13: Add "program" and "event" templates and per-workspace content types.

INSERT INTO "cms"."global_content_templates" ("key", "fields_schema", "description")
VALUES (
	'program',
	'{
		"title": { "type": "string", "required": true },
		"slug": { "type": "string", "required": true },
		"excerpt": { "type": "string", "required": false },
		"tags": { "type": "array", "items": { "type": "string" }, "required": false },
		"startDate": { "type": "datetime", "required": false },
		"endDate": { "type": "datetime", "required": false },
		"location": { "type": "string", "required": false }
	}'::jsonb,
	'Program template'
) ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "cms"."global_content_templates" ("key", "fields_schema", "description")
VALUES (
	'event',
	'{
		"title": { "type": "string", "required": true },
		"slug": { "type": "string", "required": true },
		"excerpt": { "type": "string", "required": false },
		"tags": { "type": "array", "items": { "type": "string" }, "required": false },
		"eventDate": { "type": "datetime", "required": false },
		"location": { "type": "string", "required": false }
	}'::jsonb,
	'Event template'
) ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM information_schema.tables
		WHERE table_schema = 'public' AND table_name = 'workspaces'
	) THEN
		-- Preferred: seed all workspaces.
		INSERT INTO "cms"."content_types" ("workspace_id", "template_key", "name", "slug", "config")
		SELECT w."id", 'program', 'Program', 'program', '{}'::jsonb
		FROM "public"."workspaces" w
		WHERE NOT EXISTS (
			SELECT 1 FROM "cms"."content_types" ct
			WHERE ct."workspace_id" = w."id" AND ct."template_key" = 'program'
		);

		INSERT INTO "cms"."content_types" ("workspace_id", "template_key", "name", "slug", "config")
		SELECT w."id", 'event', 'Event', 'event', '{}'::jsonb
		FROM "public"."workspaces" w
		WHERE NOT EXISTS (
			SELECT 1 FROM "cms"."content_types" ct
			WHERE ct."workspace_id" = w."id" AND ct."template_key" = 'event'
		);
	ELSE
		-- Fallback: seed workspaces already present in CMS content types.
		INSERT INTO "cms"."content_types" ("workspace_id", "template_key", "name", "slug", "config")
		SELECT ws."workspace_id", 'program', 'Program', 'program', '{}'::jsonb
		FROM (SELECT DISTINCT "workspace_id" FROM "cms"."content_types") ws
		WHERE NOT EXISTS (
			SELECT 1 FROM "cms"."content_types" ct
			WHERE ct."workspace_id" = ws."workspace_id" AND ct."template_key" = 'program'
		);

		INSERT INTO "cms"."content_types" ("workspace_id", "template_key", "name", "slug", "config")
		SELECT ws."workspace_id", 'event', 'Event', 'event', '{}'::jsonb
		FROM (SELECT DISTINCT "workspace_id" FROM "cms"."content_types") ws
		WHERE NOT EXISTS (
			SELECT 1 FROM "cms"."content_types" ct
			WHERE ct."workspace_id" = ws."workspace_id" AND ct."template_key" = 'event'
		);
	END IF;
END $$;
