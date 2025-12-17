ALTER TABLE "cms"."content_types" ADD COLUMN "route_segment" text;
--> statement-breakpoint
UPDATE "cms"."content_types"
SET "route_segment" = COALESCE(NULLIF("slug", ''), 'content-type')
WHERE "route_segment" IS NULL;
--> statement-breakpoint
UPDATE "cms"."content_types" AS ct
SET "route_segment" = 'blog'
WHERE ct."template_key" = 'blog_post'
  AND NOT EXISTS (
    SELECT 1
    FROM "cms"."content_types" AS other
    WHERE other."workspace_id" = ct."workspace_id"
      AND other."id" <> ct."id"
      AND other."route_segment" = 'blog'
  );
--> statement-breakpoint
WITH ranked AS (
  SELECT
    id,
    route_segment,
    row_number() OVER (
      PARTITION BY workspace_id, route_segment
      ORDER BY id
    ) AS rn
  FROM "cms"."content_types"
)
UPDATE "cms"."content_types" AS ct
SET "route_segment" = ct."route_segment" || '-' || ranked.rn::text
FROM ranked
WHERE ct."id" = ranked.id
  AND ranked.rn > 1;
--> statement-breakpoint
ALTER TABLE "cms"."content_types" ALTER COLUMN "route_segment" SET NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "content_types_workspace_route_segment_unique" ON "cms"."content_types" ("workspace_id","route_segment");
