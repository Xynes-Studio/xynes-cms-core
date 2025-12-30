/**
 * Content Type Ensure Defaults Handler
 *
 * CMS-TEMPLATE-CORE-1: Ensures default templates and content types exist
 * for a workspace. This is a write action that seeds the standard content
 * types (blog_post, program, event) without requiring hard-coded routes.
 */

import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { z } from "zod";
import { db } from "../../infra/db/index";
import {
  findExistingContentTypeRouteSegments,
  findExistingContentTypeSlugs,
} from "../../infra/db/repositories/content-type.repository";
import { findExistingTemplateKeys } from "../../infra/db/repositories/global-content-template.repository";
import {
  type ContentTypeDefinition,
  DEFAULT_CONTENT_TYPE_DEFINITIONS,
  DEFAULT_TEMPLATE_DEFINITIONS,
  type TemplateDefinition,
  seedContentType,
  seedTemplate,
} from "../../infra/db/seeders";
import type { ActionContext } from "../types";

export const ContentTypeEnsureDefaultsPayloadSchema = z
  .object({
    /**
     * Optional filter to only seed specific template keys.
     * If not provided, all default templates will be seeded.
     */
    templateKeys: z.array(z.string().trim().min(1)).optional(),
  })
  .strict();

export type ContentTypeEnsureDefaultsPayload = z.infer<
  typeof ContentTypeEnsureDefaultsPayloadSchema
>;

export interface EnsureDefaultsResult {
  templates: {
    created: number;
    skipped: number;
  };
  contentTypes: {
    created: number;
    skipped: number;
  };
  processedTemplateKeys: string[];
}

export interface ContentTypeEnsureDefaultsDeps {
  seedTemplate: (
    db: PostgresJsDatabase,
    template: TemplateDefinition,
  ) => Promise<void>;
  seedContentType: (
    db: PostgresJsDatabase,
    workspaceId: string,
    contentType: ContentTypeDefinition,
  ) => Promise<void>;
  findExistingTemplates: (keys: string[]) => Promise<string[]>;
  findExistingContentTypeSlugs: (
    workspaceId: string,
    slugs: string[],
  ) => Promise<string[]>;
  findExistingContentTypeRouteSegments: (
    workspaceId: string,
    routeSegments: string[],
  ) => Promise<string[]>;
}

export function createHandleContentTypeEnsureDefaults(
  database: PostgresJsDatabase,
  deps: ContentTypeEnsureDefaultsDeps,
) {
  return async function handleContentTypeEnsureDefaults(
    payload: ContentTypeEnsureDefaultsPayload,
    ctx: ActionContext,
  ): Promise<EnsureDefaultsResult> {
    const { workspaceId } = ctx;
    const { templateKeys } = payload;

    // Filter templates based on payload
    const templatesToSeed = templateKeys
      ? DEFAULT_TEMPLATE_DEFINITIONS.filter((t) => templateKeys.includes(t.key))
      : DEFAULT_TEMPLATE_DEFINITIONS;

    // Filter content types based on template keys
    const contentTypesToSeed = templateKeys
      ? DEFAULT_CONTENT_TYPE_DEFINITIONS.filter((ct) =>
          templateKeys.includes(ct.templateKey),
        )
      : DEFAULT_CONTENT_TYPE_DEFINITIONS;

    // Find existing templates to avoid unnecessary writes
    const templateKeysToCheck = templatesToSeed.map((t) => t.key);
    const existingTemplateKeys =
      await deps.findExistingTemplates(templateKeysToCheck);
    const existingTemplateSet = new Set(existingTemplateKeys);

    // Find existing content types by slug AND routeSegment to avoid unique constraint violations
    const contentTypeSlugsToCheck = contentTypesToSeed.map((ct) => ct.slug);
    const existingContentTypeSlugs = await deps.findExistingContentTypeSlugs(
      workspaceId,
      contentTypeSlugsToCheck,
    );
    const existingSlugSet = new Set(existingContentTypeSlugs);

    const routeSegmentsToCheck = contentTypesToSeed.map(
      (ct) => ct.routeSegment,
    );
    const existingRouteSegments =
      await deps.findExistingContentTypeRouteSegments(
        workspaceId,
        routeSegmentsToCheck,
      );
    const existingRouteSegmentSet = new Set(existingRouteSegments);

    // Seed templates
    let templatesCreated = 0;
    let templatesSkipped = 0;
    for (const template of templatesToSeed) {
      if (existingTemplateSet.has(template.key)) {
        templatesSkipped++;
        continue;
      }
      await deps.seedTemplate(database, template);
      templatesCreated++;
    }

    // Seed content types for the workspace
    // Skip if slug OR routeSegment already exists (unique constraint on routeSegment)
    let contentTypesCreated = 0;
    let contentTypesSkipped = 0;
    for (const contentType of contentTypesToSeed) {
      if (
        existingSlugSet.has(contentType.slug) ||
        existingRouteSegmentSet.has(contentType.routeSegment)
      ) {
        contentTypesSkipped++;
        continue;
      }
      await deps.seedContentType(database, workspaceId, contentType);
      contentTypesCreated++;
    }

    return {
      templates: {
        created: templatesCreated,
        skipped: templatesSkipped,
      },
      contentTypes: {
        created: contentTypesCreated,
        skipped: contentTypesSkipped,
      },
      processedTemplateKeys: templatesToSeed.map((t) => t.key),
    };
  };
}

// Default handler with real dependencies
export const handleContentTypeEnsureDefaults =
  createHandleContentTypeEnsureDefaults(db, {
    seedTemplate,
    seedContentType,
    findExistingTemplates: findExistingTemplateKeys,
    findExistingContentTypeSlugs,
    findExistingContentTypeRouteSegments,
  });
