import { z } from "zod";
import {
  type ContentEntry,
  type ContentEntryData,
  findPublishedEntryBySlug,
  listPublishedEntries,
} from "../../infra/db/repositories/content-entry.repository";
import { findContentTypeByRouteSegmentAndWorkspace } from "../../infra/db/repositories/content-type.repository";
import {
  ContentTypeRouteSegmentNotFoundError,
  EntryNotFoundError,
} from "../errors";
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

function normalizeEntryData(input: unknown): ContentEntryData {
  if (
    input &&
    typeof input === "object" &&
    !Array.isArray(input) &&
    Object.getPrototypeOf(input) === Object.prototype
  ) {
    return input as ContentEntryData;
  }

  if (typeof input === "string") {
    const trimmed = input.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (
          parsed &&
          typeof parsed === "object" &&
          !Array.isArray(parsed) &&
          Object.getPrototypeOf(parsed) === Object.prototype
        ) {
          return parsed as ContentEntryData;
        }
      } catch {
        // fall through
      }
    }
  }

  return {} as ContentEntryData;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asOptionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.every((v) => typeof v === "string")
    ? (value as string[])
    : undefined;
}

function toPublishedListItemDTO(entry: ContentEntry): PublishedListItemDTO {
  const data = normalizeEntryData(entry.data);
  return {
    id: entry.id,
    slug: typeof data.slug === "string" ? data.slug : "",
    title: typeof data.title === "string" ? data.title : "",
    excerpt: asOptionalString(data.excerpt),
    tags: asOptionalStringArray(data.tags),
    coverImageUrl: asOptionalString(data.coverImageUrl),
    publishedAt: entry.publishedAt,
    documentId: entry.documentId,
  };
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

    return { entries: entries.map(toPublishedListItemDTO) };
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
    if (!entry) {
      throw new EntryNotFoundError(payload.slug);
    }

    const data = normalizeEntryData(entry.data);
    return {
      entry: {
        ...toPublishedListItemDTO(entry),
        data,
      },
    };
  };
}

export const handleContentGetPublishedBySlug =
  createHandleContentGetPublishedBySlug(contentPublishedDeps);
