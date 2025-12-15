import {
  type ContentEntryData,
  createEntry as createEntryRepo,
} from "../../../infra/db/repositories/content-entry.repository";
import { findContentTypeByIdAndWorkspace as findContentTypeByIdAndWorkspaceRepo } from "../../../infra/db/repositories/content-type.repository";
import {
  ContentTypeAccessDeniedError,
  ContentTypeTemplateMismatchError,
} from "../../errors";
import type { ActionContext } from "../../types";

export interface CmsCreateEntryPayload<TData> {
  contentTypeId: string;
  documentId?: string | null;
  publishNow?: boolean;
  data: TData;
}

export interface CmsCreateEntryDto<TData> {
  id: string;
  slug: string;
  status: string;
  publishedAt: Date | null;
  documentId: string | null;
  data: TData;
}

export interface CreateEntryForTemplateDeps {
  findContentTypeByIdAndWorkspace: typeof findContentTypeByIdAndWorkspaceRepo;
  createEntry: typeof createEntryRepo;
  now: () => Date;
}

const defaultDeps: CreateEntryForTemplateDeps = {
  findContentTypeByIdAndWorkspace: findContentTypeByIdAndWorkspaceRepo,
  createEntry: createEntryRepo,
  now: () => new Date(),
};

export async function createEntryForTemplate<TData extends ContentEntryData>(
  payload: CmsCreateEntryPayload<TData>,
  ctx: ActionContext,
  expectedTemplateKey: string,
  deps: CreateEntryForTemplateDeps = defaultDeps,
): Promise<CmsCreateEntryDto<TData>> {
  const { contentTypeId, documentId, data, publishNow } = payload;
  const { workspaceId } = ctx;

  const contentType = await deps.findContentTypeByIdAndWorkspace(
    contentTypeId,
    workspaceId,
  );
  if (!contentType) {
    throw new ContentTypeAccessDeniedError(contentTypeId, workspaceId);
  }
  if (contentType.templateKey !== expectedTemplateKey) {
    throw new ContentTypeTemplateMismatchError(
      contentTypeId,
      expectedTemplateKey,
      contentType.templateKey,
    );
  }

  const shouldPublishNow = publishNow === true;
  const status = shouldPublishNow ? "published" : "draft";
  const publishedAt = shouldPublishNow ? deps.now() : null;

  const entry = await deps.createEntry({
    workspaceId,
    contentTypeId,
    documentId: documentId ?? undefined,
    data,
    status,
    publishedAt,
  });

  return {
    id: entry.id,
    slug: data.slug,
    status: entry.status,
    publishedAt: entry.publishedAt,
    documentId: entry.documentId,
    data,
  };
}
