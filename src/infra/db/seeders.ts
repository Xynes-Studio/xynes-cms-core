import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { contentTypes, globalContentTemplates } from "./schema";

// ============================================================================
// BLOG POST TEMPLATE
// ============================================================================

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

// ============================================================================
// PROGRAM TEMPLATE
// CMS-TEMPLATE-CORE-1: Template-driven content type for programs/courses
// ============================================================================

/**
 * Program fields schema definition.
 * Used for courses, workshops, training programs, etc.
 */
export const PROGRAM_FIELDS_SCHEMA = {
  slug: { type: "string", required: true },
  title: { type: "string", required: true },
  description: { type: "string", required: false },
  excerpt: { type: "string", required: false },
  duration: { type: "string", required: false }, // e.g., "4 weeks", "3 months"
  level: { type: "string", required: false }, // e.g., "beginner", "intermediate", "advanced"
  category: { type: "string", required: false },
  tags: { type: "array", items: { type: "string" }, required: false },
  coverImageUrl: { type: "string", required: false },
  price: { type: "number", required: false },
  currency: { type: "string", required: false },
  startDate: { type: "date", required: false },
  endDate: { type: "date", required: false },
  publishedAt: { type: "date", required: false },
} as const;

export const PROGRAM_TEMPLATE_KEY = "program";
export const PROGRAM_CONTENT_TYPE_SLUG = "program";
export const PROGRAM_TYPE_ROUTE_SEGMENT = "programs";

// ============================================================================
// EVENT TEMPLATE
// CMS-TEMPLATE-CORE-1: Template-driven content type for events
// ============================================================================

/**
 * Event fields schema definition.
 * Used for conferences, meetups, webinars, etc.
 */
export const EVENT_FIELDS_SCHEMA = {
  slug: { type: "string", required: true },
  title: { type: "string", required: true },
  description: { type: "string", required: false },
  excerpt: { type: "string", required: false },
  startDate: { type: "date", required: true },
  endDate: { type: "date", required: false },
  location: { type: "string", required: false }, // e.g., "Online", "New York, NY"
  venue: { type: "string", required: false }, // e.g., "Convention Center"
  address: { type: "string", required: false },
  isOnline: { type: "boolean", required: false },
  meetingUrl: { type: "string", required: false },
  capacity: { type: "number", required: false },
  price: { type: "number", required: false },
  currency: { type: "string", required: false },
  tags: { type: "array", items: { type: "string" }, required: false },
  coverImageUrl: { type: "string", required: false },
  publishedAt: { type: "date", required: false },
} as const;

export const EVENT_TEMPLATE_KEY = "event";
export const EVENT_CONTENT_TYPE_SLUG = "event";
export const EVENT_TYPE_ROUTE_SEGMENT = "events";

// ============================================================================
// DEFAULT TEMPLATE AND CONTENT TYPE DEFINITIONS
// CMS-TEMPLATE-CORE-1: Centralized definitions for seeding
// ============================================================================

export interface TemplateDefinition {
  key: string;
  fieldsSchema: Record<string, unknown>;
  description: string;
}

export interface ContentTypeDefinition {
  templateKey: string;
  name: string;
  slug: string;
  routeSegment: string;
}

/**
 * All default global template definitions.
 * These are the standard templates that can be used across all workspaces.
 */
export const DEFAULT_TEMPLATE_DEFINITIONS: TemplateDefinition[] = [
  {
    key: BLOG_POST_TEMPLATE_KEY,
    fieldsSchema: BLOG_POST_FIELDS_SCHEMA,
    description: "Standard blog post template",
  },
  {
    key: PROGRAM_TEMPLATE_KEY,
    fieldsSchema: PROGRAM_FIELDS_SCHEMA,
    description: "Program/course template for educational content",
  },
  {
    key: EVENT_TEMPLATE_KEY,
    fieldsSchema: EVENT_FIELDS_SCHEMA,
    description: "Event template for conferences, meetups, and webinars",
  },
];

/**
 * All default content type definitions.
 * These are created per-workspace when ensureDefaults is called.
 */
export const DEFAULT_CONTENT_TYPE_DEFINITIONS: ContentTypeDefinition[] = [
  {
    templateKey: BLOG_POST_TEMPLATE_KEY,
    name: "Blog Post",
    slug: BLOG_POST_CONTENT_TYPE_SLUG,
    routeSegment: BLOG_POST_TYPE_ROUTE_SEGMENT,
  },
  {
    templateKey: PROGRAM_TEMPLATE_KEY,
    name: "Program",
    slug: PROGRAM_CONTENT_TYPE_SLUG,
    routeSegment: PROGRAM_TYPE_ROUTE_SEGMENT,
  },
  {
    templateKey: EVENT_TEMPLATE_KEY,
    name: "Event",
    slug: EVENT_CONTENT_TYPE_SLUG,
    routeSegment: EVENT_TYPE_ROUTE_SEGMENT,
  },
];

// ============================================================================
// GENERIC SEEDING FUNCTIONS
// CMS-TEMPLATE-CORE-1: Generic template-driven seeding
// ============================================================================

/**
 * Seeds a single global template.
 * Idempotent: creates if not exists, updates fieldsSchema if exists.
 */
export async function seedTemplate(
  db: PostgresJsDatabase,
  template: TemplateDefinition,
): Promise<void> {
  const existingTemplates = await db
    .select()
    .from(globalContentTemplates)
    .where(eq(globalContentTemplates.key, template.key));

  if (existingTemplates.length === 0) {
    console.log(`Creating '${template.key}' template...`);
    await db.insert(globalContentTemplates).values({
      key: template.key,
      fieldsSchema: template.fieldsSchema,
      description: template.description,
    });
  } else {
    console.log(`Updating '${template.key}' template schema...`);
    await db
      .update(globalContentTemplates)
      .set({
        fieldsSchema: template.fieldsSchema,
        description: template.description,
      })
      .where(eq(globalContentTemplates.key, template.key));
  }
}

/**
 * Seeds a single content type for a workspace.
 * Idempotent: creates only if not exists (by slug).
 */
export async function seedContentType(
  db: PostgresJsDatabase,
  workspaceId: string,
  contentType: ContentTypeDefinition,
): Promise<void> {
  const existingContentType = await db
    .select()
    .from(contentTypes)
    .where(
      and(
        eq(contentTypes.workspaceId, workspaceId),
        eq(contentTypes.slug, contentType.slug),
      ),
    );

  if (existingContentType.length === 0) {
    console.log(
      `Creating content type '${contentType.slug}' for workspace ${workspaceId}...`,
    );
    await db.insert(contentTypes).values({
      workspaceId: workspaceId,
      templateKey: contentType.templateKey,
      name: contentType.name,
      slug: contentType.slug,
      routeSegment: contentType.routeSegment,
      config: {},
    });
  } else {
    console.log(
      `Content type '${contentType.slug}' already exists for workspace ${workspaceId}. Skipping.`,
    );
  }
}

/**
 * Seeds all default global templates.
 * Idempotent: safe to run multiple times.
 */
export async function seedAllDefaultTemplates(
  db: PostgresJsDatabase,
): Promise<void> {
  for (const template of DEFAULT_TEMPLATE_DEFINITIONS) {
    await seedTemplate(db, template);
  }
}

/**
 * Seeds all default content types for a workspace.
 * Idempotent: safe to run multiple times.
 */
export async function seedAllDefaultContentTypes(
  db: PostgresJsDatabase,
  workspaceId: string,
): Promise<void> {
  for (const contentType of DEFAULT_CONTENT_TYPE_DEFINITIONS) {
    await seedContentType(db, workspaceId, contentType);
  }
}

// ============================================================================
// LEGACY FUNCTIONS (for backwards compatibility)
// ============================================================================

/**
 * Seeds the blog_post global template.
 * @deprecated Use seedTemplate or seedAllDefaultTemplates instead.
 */
export async function seedBlogPostTemplate(
  db: PostgresJsDatabase,
): Promise<void> {
  await seedTemplate(db, DEFAULT_TEMPLATE_DEFINITIONS[0]);
}

/**
 * Seeds the default BlogPost content type for a workspace.
 * @deprecated Use seedContentType or seedAllDefaultContentTypes instead.
 */
export async function seedBlogPostContentType(
  db: PostgresJsDatabase,
  workspaceId: string,
): Promise<void> {
  await seedContentType(db, workspaceId, DEFAULT_CONTENT_TYPE_DEFINITIONS[0]);
}

/**
 * Runs all seed operations.
 * Seeds all default templates globally, then all default content types for the workspace.
 */
export async function runSeed(
  db: PostgresJsDatabase,
  workspaceId: string,
): Promise<void> {
  await seedAllDefaultTemplates(db);
  await seedAllDefaultContentTypes(db, workspaceId);
}
