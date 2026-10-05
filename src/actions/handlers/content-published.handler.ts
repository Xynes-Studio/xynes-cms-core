import { z } from "zod";
import {
  type ContentEntryData,
  findPublishedEntryBySlug,
  listPublishedEntries,
} from "../../infra/db/repositories/content-entry.repository";
import { findContentTypeByRouteSegmentAndWorkspace } from "../../infra/db/repositories/content-type.repository";
import type { PublicationReadRow } from "../../infra/db/repositories/publication-validation";
import {
  ContentTypeRouteSegmentNotFoundError,
  EntryNotFoundError,
} from "../errors";
import { readAvailablePublication } from "../publication-snapshot";
import type { ActionContext } from "../types";

const ROUTE_SEGMENT_RE = /^[a-z0-9-]+$/i;

export const ContentListPublishedPayloadSchema = z
  .object({
    routeSegment: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(ROUTE_SEGMENT_RE, "Invalid routeSegment"),
    limit: z.number().int().min(1).max(100).optional().default(10),
    offset: z.number().int().min(0).max(10_000).optional().default(0),
    tag: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

export type ContentListPublishedPayload = z.infer<
  typeof ContentListPublishedPayloadSchema
>;

export const ContentGetPublishedBySlugPayloadSchema = z
  .object({
    routeSegment: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(ROUTE_SEGMENT_RE, "Invalid routeSegment"),
    slug: z.string().trim().min(1).max(200),
  })
  .strict();

export type ContentGetPublishedBySlugPayload = z.infer<
  typeof ContentGetPublishedBySlugPayloadSchema
>;

export interface PublishedListItemDTO {
  id: string;
  slug: string;
  title: string;
  excerpt?: string;
  tags?: string[];
  coverImageUrl?: string;
  publishedAt: Date | null;
  documentId: string | null;
}

export interface PublishedEntryDTO extends PublishedListItemDTO {
  data: ContentEntryData;
}

export function toPublishedEntryDTO(
  entry: PublicationReadRow,
): PublishedEntryDTO | null {
  const snapshot = readAvailablePublication(entry);
  if (!snapshot?.legacy) return null;
  const { slug, excerpt, coverImageUrl, documentId } = snapshot.legacy;
  const { title, description, tags, body, publishedAt } = snapshot.entry;
  return {
    id: snapshot.entry.id,
    slug,
    title,
    excerpt,
    tags,
    coverImageUrl,
    publishedAt: new Date(publishedAt),
    documentId,
    data: {
      slug,
      title,
      description,
      tags,
      body,
      ...(excerpt !== undefined ? { excerpt } : {}),
      ...(coverImageUrl !== undefined ? { coverImageUrl } : {}),
    },
  };
}

export function toPublishedListItemDTO(
  entry: PublicationReadRow,
): PublishedListItemDTO | null {
  const dto = toPublishedEntryDTO(entry);
  if (!dto) return null;
  const { data: _data, ...summary } = dto;
  return summary;
}

export interface ContentPublishedHandlerDeps {
  findContentTypeByRouteSegmentAndWorkspace: typeof findContentTypeByRouteSegmentAndWorkspace;
  listPublishedEntries: typeof listPublishedEntries;
  findPublishedEntryBySlug: typeof findPublishedEntryBySlug;
}

const contentPublishedDeps: ContentPublishedHandlerDeps = {
  findContentTypeByRouteSegmentAndWorkspace,
  listPublishedEntries,
  findPublishedEntryBySlug,
};

export function createHandleContentListPublished(
  deps: ContentPublishedHandlerDeps,
) {
  return async function handleContentListPublished(
    payload: ContentListPublishedPayload,
    ctx: ActionContext,
  ): Promise<{ entries: PublishedListItemDTO[] }> {
    const { workspaceId } = ctx;

    const contentType = await deps.findContentTypeByRouteSegmentAndWorkspace(
      payload.routeSegment,
      workspaceId,
    );
    if (!contentType) {
      throw new ContentTypeRouteSegmentNotFoundError(payload.routeSegment);
    }

    const entries = await deps.listPublishedEntries(
      workspaceId,
      contentType.id,
      payload.limit,
      payload.offset,
      payload.tag,
    );

    return {
      entries: entries.flatMap((entry) => {
        const dto = toPublishedListItemDTO(entry);
        return dto ? [dto] : [];
      }),
    };
  };
}

export const handleContentListPublished =
  createHandleContentListPublished(contentPublishedDeps);

export function createHandleContentGetPublishedBySlug(
  deps: ContentPublishedHandlerDeps,
) {
  return async function handleContentGetPublishedBySlug(
    payload: ContentGetPublishedBySlugPayload,
    ctx: ActionContext,
  ): Promise<{ entry: PublishedEntryDTO }> {
    const { workspaceId } = ctx;

    const contentType = await deps.findContentTypeByRouteSegmentAndWorkspace(
      payload.routeSegment,
      workspaceId,
    );
    if (!contentType) {
      throw new ContentTypeRouteSegmentNotFoundError(payload.routeSegment);
    }

    const entry = await deps.findPublishedEntryBySlug(
      workspaceId,
      contentType.id,
      payload.slug,
    );
    const dto = entry ? toPublishedEntryDTO(entry) : null;
    if (!dto || dto.slug !== payload.slug)
      throw new EntryNotFoundError(payload.slug);
    return { entry: dto };
  };
}

export const handleContentGetPublishedBySlug =
  createHandleContentGetPublishedBySlug(contentPublishedDeps);
