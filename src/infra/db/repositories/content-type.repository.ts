import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../index";
import { contentTypes, globalContentTemplates } from "../schema";

export interface ContentType {
  id: string;
  workspaceId: string;
  templateKey: string;
  name: string;
  slug: string;
  routeSegment: string;
  config: unknown;
}

/**
 * Find content type by ID and verify workspace ownership.
 * Always use this for security to ensure workspace isolation.
 */
export async function findContentTypeByIdAndWorkspace(
  id: string,
  workspaceId: string,
): Promise<ContentType | null> {
  const results = await db
    .select()
    .from(contentTypes)
    .where(
      and(eq(contentTypes.id, id), eq(contentTypes.workspaceId, workspaceId)),
    );

  return results[0] ?? null;
}

/**
 * Find content type by Template Key and verify workspace ownership.
 */
export async function findContentTypeByTemplateKey(
  templateKey: string,
  workspaceId: string,
): Promise<ContentType | null> {
  const results = await db
    .select()
    .from(contentTypes)
    .where(
      and(
        eq(contentTypes.templateKey, templateKey),
        eq(contentTypes.workspaceId, workspaceId),
      ),
    );

  return results[0] ?? null;
}

/**
 * Find content type by routeSegment and verify workspace ownership.
 * routeSegment is unique per workspace.
 */
export async function findContentTypeByRouteSegmentAndWorkspace(
  routeSegment: string,
  workspaceId: string,
): Promise<ContentType | null> {
  const results = await db
    .select()
    .from(contentTypes)
    .where(
      and(
        eq(contentTypes.routeSegment, routeSegment),
        eq(contentTypes.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  return results[0] ?? null;
}

export interface WorkspaceContentTypeSummary {
  id: string;
  name: string;
  slug: string;
  routeSegment: string;
  templateKey: string;
}

export interface WorkspaceContentTypeWithTemplate
  extends WorkspaceContentTypeSummary {
  templateId: string | null;
  template: {
    id: string;
    key: string;
    name: string;
    fieldsSchema: unknown;
  } | null;
}

export interface ContentTypeWithTemplate extends ContentType {
  templateId: string | null;
  template: {
    id: string;
    key: string;
    name: string;
    fieldsSchema: unknown;
  } | null;
}

function toTemplateInfo(input: {
  templateId: string | null;
  templateKey: string;
  templateDescription: string | null;
  templateFieldsSchema: unknown;
}): Pick<ContentTypeWithTemplate, "templateId" | "template"> {
  if (!input.templateId) {
    return { templateId: null, template: null };
  }

  return {
    templateId: input.templateId,
    template: {
      id: input.templateId,
      key: input.templateKey,
      name: input.templateDescription ?? input.templateKey,
      fieldsSchema: input.templateFieldsSchema,
    },
  };
}

export async function findContentTypeWithTemplateByIdAndWorkspace(
  id: string,
  workspaceId: string,
): Promise<ContentTypeWithTemplate | null> {
  const [row] = await db
    .select({
      id: contentTypes.id,
      workspaceId: contentTypes.workspaceId,
      templateKey: contentTypes.templateKey,
      name: contentTypes.name,
      slug: contentTypes.slug,
      routeSegment: contentTypes.routeSegment,
      config: contentTypes.config,
      templateId: globalContentTemplates.id,
      templateDescription: globalContentTemplates.description,
      templateFieldsSchema: globalContentTemplates.fieldsSchema,
    })
    .from(contentTypes)
    .leftJoin(
      globalContentTemplates,
      eq(contentTypes.templateKey, globalContentTemplates.key),
    )
    .where(
      and(eq(contentTypes.id, id), eq(contentTypes.workspaceId, workspaceId)),
    )
    .limit(1);

  if (!row) return null;

  const templateInfo = toTemplateInfo({
    templateId: row.templateId ?? null,
    templateKey: row.templateKey,
    templateDescription: row.templateDescription ?? null,
    templateFieldsSchema: row.templateFieldsSchema,
  });

  return {
    id: row.id,
    workspaceId: row.workspaceId,
    templateKey: row.templateKey,
    name: row.name,
    slug: row.slug,
    routeSegment: row.routeSegment,
    config: row.config,
    ...templateInfo,
  };
}

export async function listContentTypesForWorkspace(
  workspaceId: string,
): Promise<WorkspaceContentTypeSummary[]> {
  return await db
    .select({
      id: contentTypes.id,
      name: contentTypes.name,
      slug: contentTypes.slug,
      routeSegment: contentTypes.routeSegment,
      templateKey: contentTypes.templateKey,
    })
    .from(contentTypes)
    .where(eq(contentTypes.workspaceId, workspaceId))
    .orderBy(asc(contentTypes.slug));
}

export async function listContentTypesForWorkspaceWithTemplates(
  workspaceId: string,
): Promise<WorkspaceContentTypeWithTemplate[]> {
  const rows = await db
    .select({
      contentTypeId: contentTypes.id,
      name: contentTypes.name,
      slug: contentTypes.slug,
      routeSegment: contentTypes.routeSegment,
      templateKey: contentTypes.templateKey,
      templateId: globalContentTemplates.id,
      templateDescription: globalContentTemplates.description,
      templateFieldsSchema: globalContentTemplates.fieldsSchema,
    })
    .from(contentTypes)
    .leftJoin(
      globalContentTemplates,
      eq(contentTypes.templateKey, globalContentTemplates.key),
    )
    .where(eq(contentTypes.workspaceId, workspaceId))
    .orderBy(asc(contentTypes.slug));

  return rows.map((row) => ({
    id: row.contentTypeId,
    name: row.name,
    slug: row.slug,
    routeSegment: row.routeSegment,
    templateKey: row.templateKey,
    ...toTemplateInfo({
      templateId: row.templateId ?? null,
      templateKey: row.templateKey,
      templateDescription: row.templateDescription ?? null,
      templateFieldsSchema: row.templateFieldsSchema,
    }),
  }));
}

/**
 * Finds existing content type slugs from a list of slugs for a workspace.
 * Used to check which content types already exist before seeding.
 */
export async function findExistingContentTypeSlugs(
  workspaceId: string,
  slugs: string[],
): Promise<string[]> {
  if (slugs.length === 0) return [];

  const rows = await db
    .select({ slug: contentTypes.slug })
    .from(contentTypes)
    .where(
      and(
        eq(contentTypes.workspaceId, workspaceId),
        inArray(contentTypes.slug, slugs),
      ),
    );

  return rows.map((r) => r.slug);
}

/**
 * Finds existing content type routeSegments from a list of routeSegments for a workspace.
 * Used to check which content types already exist before seeding (unique constraint check).
 */
export async function findExistingContentTypeRouteSegments(
  workspaceId: string,
  routeSegments: string[],
): Promise<string[]> {
  if (routeSegments.length === 0) return [];

  const rows = await db
    .select({ routeSegment: contentTypes.routeSegment })
    .from(contentTypes)
    .where(
      and(
        eq(contentTypes.workspaceId, workspaceId),
        inArray(contentTypes.routeSegment, routeSegments),
      ),
    );

  return rows.map((r) => r.routeSegment);
}
