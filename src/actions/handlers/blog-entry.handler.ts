import { z } from "zod";
import {
  type ContentEntryData,
  type ContentEntryStatus,
  createEntry,
  findEntryBySlug,
  findPublishedEntryBySlug,
  listAdminEntries,
  listEntriesByContentType,
  listPublishedEntries,
} from "../../infra/db/repositories/content-entry.repository";
import {
  findContentTypeByIdAndWorkspace,
  findContentTypeByTemplateKey,
} from "../../infra/db/repositories/content-type.repository";
import {
  ContentTypeAccessDeniedError,
  ContentTypeNotFoundError,
  EntryNotFoundError,
} from "../errors";
import { PUBLIC_LIST_MAX_LIMIT, zPaginationLimit } from "../pagination";
import type { ActionContext } from "../types";

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
  publishNow: z.boolean().optional(),
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

export type BlogEntryCreatePayload = z.infer<
  typeof BlogEntryCreatePayloadSchema
>;

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
  limit: zPaginationLimit({ defaultLimit: 10, maxLimit: PUBLIC_LIST_MAX_LIMIT }),
  offset: z.number().int().min(0).finite().optional().default(0),
  tag: z.string().optional(),
});

export type BlogEntryListPublishedPayload = z.infer<
  typeof BlogEntryListPublishedPayloadSchema
>;

/**
 * Schema for cms.blog_entry.getPublishedBySlug payload.
 */
export const BlogEntryGetPublishedBySlugPayloadSchema = z.object({
  slug: z.string().min(1),
});

export type BlogEntryGetPublishedBySlugPayload = z.infer<
  typeof BlogEntryGetPublishedBySlugPayloadSchema
>;

/**
 * Schema for cms.blog_entry.listAdmin payload.
 */
export const BlogEntryListAdminPayloadSchema = z.object({
  status: z
    .enum(["draft", "published", "archived", "all"])
    .optional()
    .default("all"),
  limit: z.number().int().min(1).max(100).optional().default(20),
  offset: z.number().int().min(0).optional().default(0),
  search: z.string().trim().min(1).max(200).optional(),
});

export type BlogEntryListAdminPayload = z.infer<
  typeof BlogEntryListAdminPayloadSchema
>;

export interface BlogEntryHandlerDeps {
  createEntry: typeof createEntry;
  findEntryBySlug: typeof findEntryBySlug;
  findPublishedEntryBySlug: typeof findPublishedEntryBySlug;
  listAdminEntries: typeof listAdminEntries;
  listEntriesByContentType: typeof listEntriesByContentType;
  listPublishedEntries: typeof listPublishedEntries;
  findContentTypeByIdAndWorkspace: typeof findContentTypeByIdAndWorkspace;
  findContentTypeByTemplateKey: typeof findContentTypeByTemplateKey;
}

const blogEntryDeps: BlogEntryHandlerDeps = {
  createEntry,
  findEntryBySlug,
  findPublishedEntryBySlug,
  listAdminEntries,
  listEntriesByContentType,
  listPublishedEntries,
  findContentTypeByIdAndWorkspace,
  findContentTypeByTemplateKey,
};

/**
 * Handler for cms.blog_entry.create action.
 * Validates contentTypeId belongs to workspace, creates entry.
 */
export function createHandleBlogEntryCreate(deps: BlogEntryHandlerDeps) {
  return async function handleBlogEntryCreate(
    payload: BlogEntryCreatePayload,
    ctx: ActionContext,
  ) {
    const { contentTypeId, documentId, data, publishNow } = payload;
    const { workspaceId } = ctx;

    const contentType = await deps.findContentTypeByIdAndWorkspace(
      contentTypeId,
      workspaceId,
    );
    if (!contentType) {
      throw new ContentTypeAccessDeniedError(contentTypeId, workspaceId);
    }

    const shouldPublishNow = publishNow || data.publishNow;

    let status = "draft";
    let publishedAt: Date | null = null;

    if (shouldPublishNow) {
      status = "published";
      publishedAt = new Date();
    }

    if (data.publishedAt) {
      status = "published";
      publishedAt = new Date(data.publishedAt);
    }

    const entry = await deps.createEntry({
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
  };
}

export const handleBlogEntryCreate = createHandleBlogEntryCreate(blogEntryDeps);

/**
 * Handler for cms.blog_entry.read action.
 * If slug present → return single entry or 404.
 * If no slug → list entries.
 */
export function createHandleBlogEntryRead(deps: BlogEntryHandlerDeps) {
  return async function handleBlogEntryRead(
    payload: BlogEntryReadPayload,
    ctx: ActionContext,
  ) {
    const { contentTypeId, slug } = payload;
    const { workspaceId } = ctx;

    const contentType = await deps.findContentTypeByIdAndWorkspace(
      contentTypeId,
      workspaceId,
    );
    if (!contentType) {
      throw new ContentTypeAccessDeniedError(contentTypeId, workspaceId);
    }

    if (slug) {
      const entry = await deps.findEntryBySlug(
        workspaceId,
        contentTypeId,
        slug,
      );
      if (!entry) {
        throw new EntryNotFoundError(slug);
      }
      return { entry };
    }

    const entries = await deps.listEntriesByContentType(
      workspaceId,
      contentTypeId,
    );
    return { entries };
  };
}

export const handleBlogEntryRead = createHandleBlogEntryRead(blogEntryDeps);

/**
 * Handler for cms.blog_entry.listPublished action.
 * Lists published entries for 'blog-post' content type.
 */
export function createHandleBlogEntryListPublished(deps: BlogEntryHandlerDeps) {
  return async function handleBlogEntryListPublished(
    payload: BlogEntryListPublishedPayload,
    ctx: ActionContext,
  ) {
    const { limit, offset, tag } = payload;
    const { workspaceId } = ctx;

    const contentType = await deps.findContentTypeByTemplateKey(
      "blog_post",
      workspaceId,
    );
    if (!contentType) {
      throw new ContentTypeNotFoundError("blog_post");
    }

    const entries = await deps.listPublishedEntries(
      workspaceId,
      contentType.id,
      limit,
      offset,
      tag,
    );

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
  };
}

export const handleBlogEntryListPublished =
  createHandleBlogEntryListPublished(blogEntryDeps);

/**
 * Handler for cms.blog_entry.getPublishedBySlug action.
 * Returns single published entry for 'blog-post' content type.
 */
export function createHandleBlogEntryGetPublishedBySlug(
  deps: BlogEntryHandlerDeps,
) {
  return async function handleBlogEntryGetPublishedBySlug(
    payload: BlogEntryGetPublishedBySlugPayload,
    ctx: ActionContext,
  ) {
    const { slug } = payload;
    const { workspaceId } = ctx;

    const contentType = await deps.findContentTypeByTemplateKey(
      "blog_post",
      workspaceId,
    );
    if (!contentType) {
      throw new ContentTypeNotFoundError("blog_post");
    }

    const entry = await deps.findPublishedEntryBySlug(
      workspaceId,
      contentType.id,
      slug,
    );
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
  };
}

export const handleBlogEntryGetPublishedBySlug =
  createHandleBlogEntryGetPublishedBySlug(blogEntryDeps);

function asAdminField(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Handler for cms.blog_entry.listAdmin action.
 * Lists draft/published/archived entries for 'blog_post' content type (admin view).
 *
 * Ordering: updatedAt DESC.
 */
export function createHandleBlogEntryListAdmin(deps: BlogEntryHandlerDeps) {
  return async function handleBlogEntryListAdmin(
    payload: BlogEntryListAdminPayload,
    ctx: ActionContext,
  ) {
    const { status, limit, offset, search } = payload;
    const { workspaceId } = ctx;

    const contentType = await deps.findContentTypeByTemplateKey(
      "blog_post",
      workspaceId,
    );
    if (!contentType) {
      throw new ContentTypeNotFoundError("blog_post");
    }

    const statusFilter: ContentEntryStatus | undefined =
      status === "all" ? undefined : (status as ContentEntryStatus);

    const entries = await deps.listAdminEntries({
      workspaceId,
      contentTypeId: contentType.id,
      status: statusFilter,
      limit,
      offset,
      search,
    });

    return {
      items: entries.map((e) => {
        const data = e.data as ContentEntryData;
        return {
          id: e.id,
          slug: asAdminField(data?.slug) ?? "",
          title: asAdminField(data?.title) ?? "",
          status: e.status,
          publishedAt: e.publishedAt,
          updatedAt: e.updatedAt,
          documentId: e.documentId,
          data: e.data,
        };
      }),
    };
  };
}

export const handleBlogEntryListAdmin =
  createHandleBlogEntryListAdmin(blogEntryDeps);
