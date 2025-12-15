import { z } from "zod";
import {
  findPublishedEntryBySlug,
  listPublishedEntries,
} from "../../infra/db/repositories/content-entry.repository";
import { findContentTypeByTemplateKey } from "../../infra/db/repositories/content-type.repository";
import { ContentTypeNotFoundError, EntryNotFoundError } from "../errors";
import type { ActionContext } from "../types";
import {
  type CreateEntryForTemplateDeps,
  createEntryForTemplate,
} from "./_shared/content-entry-create";
import { IsoDateTimeStringSchema } from "./_shared/schemas";

export const ProgramEntryDataSchema = z
  .object({
    slug: z.string().min(1),
    title: z.string().min(1),
    excerpt: z.string().optional(),
    tags: z.array(z.string()).optional(),
    startDate: IsoDateTimeStringSchema.optional(),
    endDate: IsoDateTimeStringSchema.optional(),
    location: z.string().optional(),
  })
  .strict();

export const ProgramCreatePayloadSchema = z
  .object({
    contentTypeId: z.string().uuid(),
    documentId: z.string().uuid().nullable().optional(),
    publishNow: z.boolean().optional(),
    data: ProgramEntryDataSchema,
  })
  .strict();

export type ProgramCreatePayload = z.infer<typeof ProgramCreatePayloadSchema>;

export function makeProgramCreateHandler(deps?: CreateEntryForTemplateDeps) {
  return async (payload: ProgramCreatePayload, ctx: ActionContext) => {
    const entry = await createEntryForTemplate(payload, ctx, "program", deps);
    return { entry };
  };
}

export const handleProgramCreate = makeProgramCreateHandler();

export const ProgramListPublishedPayloadSchema = z
  .object({
    limit: z.number().int().min(0).max(100).optional().default(10),
    offset: z.number().int().min(0).optional().default(0),
    tag: z.string().optional(),
  })
  .strict();

export type ProgramListPublishedPayload = z.infer<
  typeof ProgramListPublishedPayloadSchema
>;

export interface ProgramPublishedListDeps {
  findContentTypeByTemplateKey: typeof findContentTypeByTemplateKey;
  listPublishedEntries: typeof listPublishedEntries;
}

function toPublishedProgramDto(entry: {
  id: string;
  documentId: string | null;
  publishedAt: Date | null;
  data: {
    slug: string;
    title: string;
    excerpt?: string;
    tags?: string[];
    startDate?: string;
    endDate?: string;
    location?: string;
  };
}) {
  return {
    id: entry.id,
    slug: entry.data.slug,
    title: entry.data.title,
    excerpt: entry.data.excerpt,
    tags: entry.data.tags,
    publishedAt: entry.publishedAt,
    documentId: entry.documentId,
    data: {
      startDate: entry.data.startDate,
      endDate: entry.data.endDate,
      location: entry.data.location,
    },
  };
}

const defaultListDeps: ProgramPublishedListDeps = {
  findContentTypeByTemplateKey,
  listPublishedEntries,
};

export function makeProgramListPublishedHandler(
  deps: ProgramPublishedListDeps = defaultListDeps,
) {
  return async (payload: ProgramListPublishedPayload, ctx: ActionContext) => {
    const { limit, offset, tag } = payload;
    const { workspaceId } = ctx;

    const contentType = await deps.findContentTypeByTemplateKey(
      "program",
      workspaceId,
    );
    if (!contentType) {
      throw new ContentTypeNotFoundError("program");
    }

    const entries = await deps.listPublishedEntries(
      workspaceId,
      contentType.id,
      limit,
      offset,
      tag,
    );

    return {
      entries: entries.map(toPublishedProgramDto),
    };
  };
}

export const handleProgramListPublished = makeProgramListPublishedHandler();

export const ProgramGetPublishedBySlugPayloadSchema = z
  .object({
    slug: z.string().min(1),
  })
  .strict();

export type ProgramGetPublishedBySlugPayload = z.infer<
  typeof ProgramGetPublishedBySlugPayloadSchema
>;

export interface ProgramPublishedBySlugDeps {
  findContentTypeByTemplateKey: typeof findContentTypeByTemplateKey;
  findPublishedEntryBySlug: typeof findPublishedEntryBySlug;
}

const defaultGetBySlugDeps: ProgramPublishedBySlugDeps = {
  findContentTypeByTemplateKey,
  findPublishedEntryBySlug,
};

export function makeProgramGetPublishedBySlugHandler(
  deps: ProgramPublishedBySlugDeps = defaultGetBySlugDeps,
) {
  return async (
    payload: ProgramGetPublishedBySlugPayload,
    ctx: ActionContext,
  ) => {
    const { slug } = payload;
    const { workspaceId } = ctx;

    const contentType = await deps.findContentTypeByTemplateKey(
      "program",
      workspaceId,
    );
    if (!contentType) {
      throw new ContentTypeNotFoundError("program");
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
        ...toPublishedProgramDto(entry),
      },
    };
  };
}

export const handleProgramGetPublishedBySlug =
  makeProgramGetPublishedBySlugHandler();
