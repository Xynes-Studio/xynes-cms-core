import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type {
  ContentTemplateDefinition,
  WorkspaceContentTypeDefinition,
} from "../content-templates";
import {
  BLOG_POST_CONTENT_TYPE,
  BLOG_POST_TEMPLATE,
  EVENT_CONTENT_TYPE,
  EVENT_TEMPLATE,
  PROGRAM_CONTENT_TYPE,
  PROGRAM_TEMPLATE,
  parseFieldsSchema,
} from "../content-templates";
import { contentTypes, globalContentTemplates } from "./schema";

export const BLOG_POST_FIELDS_SCHEMA = BLOG_POST_TEMPLATE.fieldsSchema;
export const BLOG_POST_TEMPLATE_KEY = BLOG_POST_TEMPLATE.key;
export const BLOG_POST_CONTENT_TYPE_SLUG = BLOG_POST_CONTENT_TYPE.slug;

export const PROGRAM_FIELDS_SCHEMA = PROGRAM_TEMPLATE.fieldsSchema;
export const PROGRAM_TEMPLATE_KEY = PROGRAM_TEMPLATE.key;
export const PROGRAM_CONTENT_TYPE_SLUG = PROGRAM_CONTENT_TYPE.slug;

export const EVENT_FIELDS_SCHEMA = EVENT_TEMPLATE.fieldsSchema;
export const EVENT_TEMPLATE_KEY = EVENT_TEMPLATE.key;
export const EVENT_CONTENT_TYPE_SLUG = EVENT_CONTENT_TYPE.slug;

async function upsertGlobalTemplate(
  db: PostgresJsDatabase,
  template: ContentTemplateDefinition,
): Promise<void> {
  const fieldsSchema = parseFieldsSchema(template.fieldsSchema);
  const existingTemplates = await db
    .select()
    .from(globalContentTemplates)
    .where(eq(globalContentTemplates.key, template.key));

  if (existingTemplates.length === 0) {
    await db.insert(globalContentTemplates).values({
      key: template.key,
      fieldsSchema,
      description: template.description,
    });
    return;
  }

  await db
    .update(globalContentTemplates)
    .set({ fieldsSchema })
    .where(eq(globalContentTemplates.key, template.key));
}

async function ensureWorkspaceContentType(
  db: PostgresJsDatabase,
  workspaceId: string,
  contentType: WorkspaceContentTypeDefinition,
): Promise<void> {
  const existingContentType = await db
    .select()
    .from(contentTypes)
    .where(
      and(
        eq(contentTypes.workspaceId, workspaceId),
        eq(contentTypes.templateKey, contentType.templateKey),
      ),
    );

  if (existingContentType.length > 0) {
    return;
  }

  await db.insert(contentTypes).values({
    workspaceId,
    templateKey: contentType.templateKey,
    name: contentType.name,
    slug: contentType.slug,
    config: {},
  });
}

/**
 * Seeds the blog_post global template.
 * Idempotent: creates if not exists, updates fieldsSchema if exists.
 */
export async function seedBlogPostTemplate(
  db: PostgresJsDatabase,
): Promise<void> {
  console.log("Ensuring blog_post template...");
  await upsertGlobalTemplate(db, BLOG_POST_TEMPLATE);
}

export async function seedProgramTemplate(
  db: PostgresJsDatabase,
): Promise<void> {
  console.log("Ensuring program template...");
  await upsertGlobalTemplate(db, PROGRAM_TEMPLATE);
}

export async function seedEventTemplate(db: PostgresJsDatabase): Promise<void> {
  console.log("Ensuring event template...");
  await upsertGlobalTemplate(db, EVENT_TEMPLATE);
}

/**
 * Seeds the default BlogPost content type for a workspace.
 * Idempotent: creates only if not exists.
 */
export async function seedBlogPostContentType(
  db: PostgresJsDatabase,
  workspaceId: string,
): Promise<void> {
  console.log(
    `Ensuring content type '${BLOG_POST_CONTENT_TYPE_SLUG}' for workspace ${workspaceId}...`,
  );
  await ensureWorkspaceContentType(db, workspaceId, BLOG_POST_CONTENT_TYPE);
}

export async function seedProgramContentType(
  db: PostgresJsDatabase,
  workspaceId: string,
): Promise<void> {
  console.log(
    `Ensuring content type '${PROGRAM_CONTENT_TYPE_SLUG}' for workspace ${workspaceId}...`,
  );
  await ensureWorkspaceContentType(db, workspaceId, PROGRAM_CONTENT_TYPE);
}

export async function seedEventContentType(
  db: PostgresJsDatabase,
  workspaceId: string,
): Promise<void> {
  console.log(
    `Ensuring content type '${EVENT_CONTENT_TYPE_SLUG}' for workspace ${workspaceId}...`,
  );
  await ensureWorkspaceContentType(db, workspaceId, EVENT_CONTENT_TYPE);
}

/**
 * Runs all seed operations for CMS core defaults.
 */
export async function runSeed(
  db: PostgresJsDatabase,
  workspaceId: string,
): Promise<void> {
  await seedBlogPostTemplate(db);
  await seedProgramTemplate(db);
  await seedEventTemplate(db);
  await seedBlogPostContentType(db, workspaceId);
  await seedProgramContentType(db, workspaceId);
  await seedEventContentType(db, workspaceId);
}
