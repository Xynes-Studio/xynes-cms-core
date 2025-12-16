import { z } from "zod";
import type {
  ContentEntryData,
  ContentEntryStatus,
} from "../../infra/db/repositories/content-entry.repository";
import {
  findEntryByIdAndWorkspace,
  updateEntryByIdAndWorkspace,
} from "../../infra/db/repositories/content-entry.repository";
import { findContentTypeByIdAndWorkspace } from "../../infra/db/repositories/content-type.repository";
import { ContentTypeNotFoundError, EntryNotFoundError } from "../errors";
import type { ActionContext } from "../types";

/**
 * Schema for cms.blog_entry.updateMeta payload.
 */
export const BlogEntryUpdateMetaDataSchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    slug: z.string().trim().min(1).optional(),
    excerpt: z.string().trim().max(2000).optional(),
    tags: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
    coverImageUrl: z.string().url().optional(),
  })
  .strict();

export const BlogEntryUpdateMetaPayloadSchema = z
  .object({
    id: z.string().uuid(),
    data: BlogEntryUpdateMetaDataSchema.optional(),
    publishNow: z.boolean().optional(),
    unpublish: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const wantsPublish = value.publishNow === true;
    const wantsUnpublish = value.unpublish === true;

    if (wantsPublish && wantsUnpublish) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "publishNow and unpublish cannot both be true",
        path: ["publishNow"],
      });
    }

    const dataValues = value.data ? Object.values(value.data) : [];
    const hasAnyDataField = dataValues.some((field) => field !== undefined);

    if (!hasAnyDataField && !wantsPublish && !wantsUnpublish) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one of data, publishNow, unpublish must be present",
        path: [],
      });
    }
  });

export type BlogEntryUpdateMetaPayload = z.infer<
  typeof BlogEntryUpdateMetaPayloadSchema
>;

function normalizeJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) return {};
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        return {};
      }
    }
  }

  return {};
}

function pickDefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      (out as Record<string, unknown>)[key] = value;
    }
  }
  return out;
}

function safeMergeMeta(
  existing: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const blockedKeys = new Set(["__proto__", "prototype", "constructor"]);
  const merged: Record<string, unknown> = { ...existing };
  for (const [key, value] of Object.entries(patch)) {
    if (blockedKeys.has(key)) continue;
    merged[key] = value;
  }
  return merged;
}

export function applyBlogEntryMetaUpdate(
  current: {
    data: unknown;
    status: ContentEntryStatus;
    publishedAt: Date | null;
  },
  input: Pick<BlogEntryUpdateMetaPayload, "data" | "publishNow" | "unpublish">,
  now: Date = new Date(),
): {
  data: Record<string, unknown>;
  status: ContentEntryStatus;
  publishedAt: Date | null;
} {
  const existingData = normalizeJsonObject(current.data);
  const patch = input.data ? pickDefined(input.data) : undefined;
  const nextData = patch ? safeMergeMeta(existingData, patch) : existingData;

  if (input.publishNow) {
    return { data: nextData, status: "published", publishedAt: now };
  }

  if (input.unpublish) {
    return { data: nextData, status: "draft", publishedAt: null };
  }

  return {
    data: nextData,
    status: current.status,
    publishedAt: current.publishedAt,
  };
}

/**
 * Handler for cms.blog_entry.updateMeta action.
 * Updates metadata and/or publish state without touching document content.
 */
export async function handleBlogEntryUpdateMeta(
  payload: BlogEntryUpdateMetaPayload,
  ctx: ActionContext,
) {
  const { workspaceId } = ctx;

  const entry = await findEntryByIdAndWorkspace(payload.id, workspaceId);
  if (!entry) {
    throw new EntryNotFoundError(payload.id);
  }

  const contentType = await findContentTypeByIdAndWorkspace(
    entry.contentTypeId,
    workspaceId,
  );
  if (!contentType) {
    throw new ContentTypeNotFoundError(entry.contentTypeId);
  }
  if (contentType.templateKey !== "blog_post") {
    throw new EntryNotFoundError(payload.id);
  }

  const update = applyBlogEntryMetaUpdate(
    {
      data: entry.data,
      status: entry.status as ContentEntryStatus,
      publishedAt: entry.publishedAt,
    },
    payload,
  );

  const shouldUpdateData = payload.data !== undefined;
  const shouldUpdatePublishState =
    payload.publishNow === true || payload.unpublish === true;

  const updated = await updateEntryByIdAndWorkspace({
    entryId: entry.id,
    workspaceId,
    contentTypeId: entry.contentTypeId,
    ...(shouldUpdateData ? { data: update.data as ContentEntryData } : {}),
    ...(shouldUpdatePublishState
      ? { status: update.status, publishedAt: update.publishedAt }
      : {}),
  });

  if (!updated) {
    throw new EntryNotFoundError(payload.id);
  }

  return { success: true, entry: updated };
}
