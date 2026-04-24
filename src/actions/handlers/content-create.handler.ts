import { z } from "zod";
import {
  type ContentEntryData,
  type ContentEntryStatus,
  createEntry,
} from "../../infra/db/repositories/content-entry.repository";
import { findContentTypeWithTemplateByIdAndWorkspace } from "../../infra/db/repositories/content-type.repository";
import { ContentTypeNotFoundError, ValidationError } from "../errors";
import type { ActionContext } from "../types";

const FORBIDDEN_OWN_DATA_KEYS = new Set(["constructor", "prototype"]);

export const ContentCreateDataSchema = z
  .object({
    slug: z.string().trim().min(1),
    title: z.string().trim().min(1),
    publishNow: z.boolean().optional(),
    publishedAt: z.string().trim().min(1).nullable().optional(),
  })
  .passthrough()
  .superRefine((data, ctx) => {
    // Defensive: reject non-plain objects (e.g. "__proto__" payloads that mutate prototypes during parsing).
    if (Object.getPrototypeOf(data) !== Object.prototype) {
      ctx.addIssue({
        code: "custom",
        path: [],
        message: "Invalid data payload",
      });
      return;
    }

    for (const key of FORBIDDEN_OWN_DATA_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(data, key)) continue;
      ctx.addIssue({
        code: "custom",
        path: [key],
        message: "Forbidden key in data payload",
      });
    }
  });

export const ContentCreatePayloadSchema = z
  .object({
    contentTypeId: z.string().uuid(),
    documentId: z.string().uuid().nullable().optional(),
    publishNow: z.boolean().optional(),
    data: ContentCreateDataSchema,
  })
  .strict();

export type ContentCreatePayload = z.infer<typeof ContentCreatePayloadSchema>;

export interface ContentCreateEntryDTO {
  id: string;
  contentTypeId: string;
  routeSegment: string;
  slug: string;
  status: string;
  publishedAt: Date | null;
  documentId: string | null;
  data: {
    slug: string;
    title: string;
  };
}

export interface ContentCreateDeps {
  createEntry: typeof createEntry;
  findContentTypeWithTemplateByIdAndWorkspace: typeof findContentTypeWithTemplateByIdAndWorkspace;
}

function parsePublishedAt(value: unknown): Date | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function createHandleContentCreate(deps: ContentCreateDeps) {
  return async function handleContentCreate(
    payload: ContentCreatePayload,
    ctx: ActionContext,
  ): Promise<{ entry: ContentCreateEntryDTO }> {
    const { workspaceId } = ctx;

    const contentType = await deps.findContentTypeWithTemplateByIdAndWorkspace(
      payload.contentTypeId,
      workspaceId,
    );
    if (!contentType) {
      throw new ContentTypeNotFoundError(payload.contentTypeId);
    }

    if (
      !contentType.routeSegment ||
      contentType.routeSegment.trim().length === 0
    ) {
      throw new ValidationError("Content type is missing routeSegment");
    }

    if (!contentType.template) {
      throw new ValidationError(
        "Content type template not found (template misconfiguration)",
      );
    }

    const shouldPublishNow = payload.publishNow || payload.data.publishNow;
    const publishedAtRaw = payload.data.publishedAt;
    const explicitPublishedAt =
      publishedAtRaw === null ? null : parsePublishedAt(publishedAtRaw);
    if (publishedAtRaw && !explicitPublishedAt) {
      throw new ValidationError("Invalid publishedAt");
    }

    let status: ContentEntryStatus = "draft";
    let publishedAt: Date | null = null;
    if (explicitPublishedAt) {
      status = "published";
      publishedAt = explicitPublishedAt;
    } else if (shouldPublishNow) {
      status = "published";
      publishedAt = new Date();
    }

    const documentId =
      payload.documentId === null ? undefined : payload.documentId;

    const entry = await deps.createEntry({
      workspaceId,
      contentTypeId: payload.contentTypeId,
      documentId,
      status,
      publishedAt,
      createdBy: ctx.userId ?? null,
      updatedBy: ctx.userId ?? null,
      data: payload.data as ContentEntryData,
    });

    return {
      entry: {
        id: entry.id,
        contentTypeId: entry.contentTypeId,
        routeSegment: contentType.routeSegment,
        slug: entry.data.slug,
        status: entry.status,
        publishedAt: entry.publishedAt,
        documentId: entry.documentId,
        data: {
          slug: entry.data.slug,
          title: entry.data.title,
        },
      },
    };
  };
}

export const handleContentCreate = createHandleContentCreate({
  createEntry,
  findContentTypeWithTemplateByIdAndWorkspace,
});
