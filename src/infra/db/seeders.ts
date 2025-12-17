import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { contentTypes, globalContentTemplates } from "./schema";

/**
 * Blog post fields schema definition.
 * Matches the user story requirements for CMS-4.
 */
export const BLOG_POST_FIELDS_SCHEMA = {
  slug: { type: "string", required: true },
  title: { type: "string", required: true },
  excerpt: { type: "string", required: false },
  tags: { type: "array", items: { type: "string" }, required: false },
  coverImageUrl: { type: "string", required: false },
  publishedAt: { type: "date", required: false },
} as const;

export const BLOG_POST_TEMPLATE_KEY = "blog_post";
export const BLOG_POST_CONTENT_TYPE_SLUG = "blog-post";
export const BLOG_POST_TYPE_ROUTE_SEGMENT = "blog";

/**
 * Seeds the blog_post global template.
 * Idempotent: creates if not exists, updates fieldsSchema if exists.
 */
export async function seedBlogPostTemplate(
  db: PostgresJsDatabase,
): Promise<void> {
  const existingTemplates = await db
    .select()
    .from(globalContentTemplates)
    .where(eq(globalContentTemplates.key, BLOG_POST_TEMPLATE_KEY));

  if (existingTemplates.length === 0) {
    console.log("Creating blog_post template...");
    await db.insert(globalContentTemplates).values({
      key: BLOG_POST_TEMPLATE_KEY,
      fieldsSchema: BLOG_POST_FIELDS_SCHEMA,
      description: "Standard blog post template",
    });
  } else {
    console.log("Updating blog_post template schema...");
    await db
      .update(globalContentTemplates)
      .set({ fieldsSchema: BLOG_POST_FIELDS_SCHEMA })
      .where(eq(globalContentTemplates.key, BLOG_POST_TEMPLATE_KEY));
  }
}

/**
 * Seeds the default BlogPost content type for a workspace.
 * Idempotent: creates only if not exists.
 */
export async function seedBlogPostContentType(
  db: PostgresJsDatabase,
  workspaceId: string,
): Promise<void> {
  const existingContentType = await db
    .select()
    .from(contentTypes)
    .where(
      and(
        eq(contentTypes.workspaceId, workspaceId),
        eq(contentTypes.slug, BLOG_POST_CONTENT_TYPE_SLUG),
      ),
    );

  if (existingContentType.length === 0) {
    console.log(
      `Creating content type '${BLOG_POST_CONTENT_TYPE_SLUG}' for workspace ${workspaceId}...`,
    );
    await db.insert(contentTypes).values({
      workspaceId: workspaceId,
      templateKey: BLOG_POST_TEMPLATE_KEY,
      name: "Blog Post",
      slug: BLOG_POST_CONTENT_TYPE_SLUG,
      routeSegment: BLOG_POST_TYPE_ROUTE_SEGMENT,
      config: {},
    });
  } else {
    console.log(
      `Content type '${BLOG_POST_CONTENT_TYPE_SLUG}' already exists for workspace ${workspaceId}. Skipping.`,
    );
  }
}

/**
 * Runs all seed operations for CMS-4.
 */
export async function runSeed(
  db: PostgresJsDatabase,
  workspaceId: string,
): Promise<void> {
  await seedBlogPostTemplate(db);
  await seedBlogPostContentType(db, workspaceId);
}
