import { z } from "zod";
import type { ActionContext } from "../types";
import {
  ContentTypeNotFoundError,
  ContentTypeAccessDeniedError,
  EntryNotFoundError,
} from "../errors";
import {
  findContentTypeByIdAndWorkspace,
} from "../../infra/db/repositories/content-type.repository";
import {
  createEntry,
  findEntryBySlug,
  listEntriesByContentType,
  type ContentEntryData,
} from "../../infra/db/repositories/content-entry.repository";

/**
 * Schema for blog entry data.
 */
export const BlogEntryDataSchema = z.object({
  slug: z.string().min(1),
  title: z.string().min(1),
  excerpt: z.string().optional(),
  tags: z.array(z.string()).optional(),
  coverImageUrl: z.string().url().optional(),
  publishedAt: z.string().nullable().optional(),
});

/**
 * Schema for cms.blog_entry.create payload.
 */
export const BlogEntryCreatePayloadSchema = z.object({
  contentTypeId: z.string().uuid(),
  documentId: z.string().uuid().optional(),
  data: BlogEntryDataSchema,
});

export type BlogEntryCreatePayload = z.infer<typeof BlogEntryCreatePayloadSchema>;

/**
 * Schema for cms.blog_entry.read payload.
 */
export const BlogEntryReadPayloadSchema = z.object({
  contentTypeId: z.string().uuid(),
  slug: z.string().optional(),
});

export type BlogEntryReadPayload = z.infer<typeof BlogEntryReadPayloadSchema>;

/**
 * Handler for cms.blog_entry.create action.
 * Validates contentTypeId belongs to workspace, creates entry.
 */
export async function handleBlogEntryCreate(
  payload: BlogEntryCreatePayload,
  ctx: ActionContext
) {
  const { contentTypeId, documentId, data } = payload;
  const { workspaceId } = ctx;

  // Validate contentTypeId belongs to this workspace
  const contentType = await findContentTypeByIdAndWorkspace(contentTypeId, workspaceId);
  if (!contentType) {
    throw new ContentTypeAccessDeniedError(contentTypeId, workspaceId);
  }

  // Create the entry
  const entry = await createEntry({
    workspaceId,
    contentTypeId,
    documentId,
    data: data as ContentEntryData,
  });

  return {
    success: true,
    entry,
  };
}

/**
 * Handler for cms.blog_entry.read action.
 * If slug present → return single entry or 404.
 * If no slug → list entries.
 */
export async function handleBlogEntryRead(
  payload: BlogEntryReadPayload,
  ctx: ActionContext
) {
  const { contentTypeId, slug } = payload;
  const { workspaceId } = ctx;

  // Validate contentTypeId belongs to this workspace
  const contentType = await findContentTypeByIdAndWorkspace(contentTypeId, workspaceId);
  if (!contentType) {
    throw new ContentTypeAccessDeniedError(contentTypeId, workspaceId);
  }

  if (slug) {
    // Return single entry by slug
    const entry = await findEntryBySlug(workspaceId, contentTypeId, slug);
    if (!entry) {
      throw new EntryNotFoundError(slug);
    }
    return { entry };
  }

  // List all entries
  const entries = await listEntriesByContentType(workspaceId, contentTypeId);
  return { entries };
}
