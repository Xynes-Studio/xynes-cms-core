import { z } from "zod";
import type { ActionContext } from "../types";
import {
  ContentTypeNotFoundError,
  ContentTypeAccessDeniedError,
  EntryNotFoundError,
} from "../errors";
import {
  createEntry,
  findEntryBySlug,
  listEntriesByContentType,
  listPublishedEntries,
  findPublishedEntryBySlug,
  type ContentEntryData,
} from "../../infra/db/repositories/content-entry.repository";
import {
  findContentTypeByIdAndWorkspace,
  findContentTypeByTemplateKey,
} from "../../infra/db/repositories/content-type.repository";

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
  publishNow: z.boolean().optional(),
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
 * Schema for cms.blog_entry.listPublished payload.
 */
export const BlogEntryListPublishedPayloadSchema = z.object({
  limit: z.number().optional().default(10),
  offset: z.number().optional().default(0),
  tag: z.string().optional(),
});

export type BlogEntryListPublishedPayload = z.infer<typeof BlogEntryListPublishedPayloadSchema>;

/**
 * Schema for cms.blog_entry.getPublishedBySlug payload.
 */
export const BlogEntryGetPublishedBySlugPayloadSchema = z.object({
  slug: z.string().min(1),
});

export type BlogEntryGetPublishedBySlugPayload = z.infer<typeof BlogEntryGetPublishedBySlugPayloadSchema>;

/**
 * Handler for cms.blog_entry.create action.
 * Validates contentTypeId belongs to workspace, creates entry.
 */
export async function handleBlogEntryCreate(
  payload: BlogEntryCreatePayload,
  ctx: ActionContext
) {
  const { contentTypeId, documentId, data, publishNow } = payload;
  const { workspaceId } = ctx;

  // Validate contentTypeId belongs to this workspace
  const contentType = await findContentTypeByIdAndWorkspace(contentTypeId, workspaceId);
  if (!contentType) {
    throw new ContentTypeAccessDeniedError(contentTypeId, workspaceId);
  }

  // Determine status and publishedAt
  let status = "draft";
  let publishedAt: Date | null = null;

  if (publishNow) {
    status = "published";
    publishedAt = new Date();
  }

  if (data.publishedAt) {
    status = "published";
    publishedAt = new Date(data.publishedAt);
  }

  // Create the entry
  const entry = await createEntry({
    workspaceId,
    contentTypeId,
    documentId,
    data: data as ContentEntryData,
    status,
    publishedAt,
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

/**
 * Handler for cms.blog_entry.listPublished action.
 * Lists published entries for 'blog-post' content type.
 */
export async function handleBlogEntryListPublished(
  payload: BlogEntryListPublishedPayload,
  ctx: ActionContext
) {
  const { limit, offset, tag } = payload;
  const { workspaceId } = ctx;

  // Look up "blog-post" content type
  const contentType = await findContentTypeByTemplateKey("blog-post", workspaceId!);
  if (!contentType) {
     throw new ContentTypeNotFoundError("blog-post");
  }

  const entries = await listPublishedEntries(
    workspaceId!,
    contentType.id,
    limit,
    offset,
    tag
  );

  // Map to simplified response
  return {
    entries: entries.map((e) => ({
      id: e.id,
      slug: e.data.slug,
      title: e.data.title,
      excerpt: e.data.excerpt,
      tags: e.data.tags,
      coverImageUrl: e.data.coverImageUrl,
      publishedAt: e.publishedAt,
      documentId: e.documentId,
    })),
  };
}

/**
 * Handler for cms.blog_entry.getPublishedBySlug action.
 * Returns single published entry for 'blog-post' content type.
 */
export async function handleBlogEntryGetPublishedBySlug(
  payload: BlogEntryGetPublishedBySlugPayload,
  ctx: ActionContext
) {
  const { slug } = payload;
  const { workspaceId } = ctx;

  // Look up "blog-post" content type
  const contentType = await findContentTypeByTemplateKey("blog-post", workspaceId!);
  if (!contentType) {
     throw new ContentTypeNotFoundError("blog-post");
  }

  const entry = await findPublishedEntryBySlug(workspaceId!, contentType.id, slug);
  if (!entry) {
    throw new EntryNotFoundError(slug);
  }

  return {
    entry: {
      id: entry.id,
      slug: entry.data.slug,
      title: entry.data.title,
      excerpt: entry.data.excerpt,
      tags: entry.data.tags,
      coverImageUrl: entry.data.coverImageUrl,
      publishedAt: entry.publishedAt,
      documentId: entry.documentId,
    },
  };
}
