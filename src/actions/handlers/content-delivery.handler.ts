import { z } from "zod";
import {
  getDeliveryEntry,
  listDeliveryEntries,
} from "../../infra/db/repositories/content-delivery.repository";
import { DomainError } from "../errors";
import type { PublicationSnapshot } from "../publication-snapshot";
import type {
  ContentDeliveryDirectoryOptions,
  ContentDeliveryEntryOptions,
  DELIVERY_DETAIL_FIELDS,
  DeliveryEntry,
  DeliveryListItem,
  DeliverySummary,
} from "../schemas/content-delivery";
import type { ActionContext } from "../types";

export interface ContentDeliveryHandlerDeps {
  list(
    options: ContentDeliveryDirectoryOptions & { workspaceId: string },
  ): Promise<DeliverySummary[]>;
  get(
    options: ContentDeliveryEntryOptions & { workspaceId: string },
  ): Promise<PublicationSnapshot["entry"] | null>;
}

function project(
  entry: DeliverySummary & Partial<Pick<PublicationSnapshot["entry"], "body">>,
  fields: readonly (typeof DELIVERY_DETAIL_FIELDS)[number][],
): DeliveryEntry {
  const dto: DeliveryEntry = { id: entry.id };
  for (const field of fields) {
    switch (field) {
      case "id":
        break;
      case "title":
        dto.title = entry.title;
        break;
      case "description":
        dto.description = entry.description;
        break;
      case "tags":
        dto.tags = entry.tags;
        break;
      case "publishedAt":
        dto.publishedAt = entry.publishedAt;
        break;
      case "body":
        dto.body = entry.body;
        break;
    }
  }
  return dto;
}

export function createHandleDeliveryListByDirectory(
  deps: ContentDeliveryHandlerDeps,
) {
  return async (
    options: ContentDeliveryDirectoryOptions,
    ctx: ActionContext,
  ): Promise<{
    items: DeliveryListItem[];
    page: { limit: number; offset: number; hasMore: boolean };
  }> => {
    const workspaceId = z.string().uuid().parse(ctx.workspaceId);
    const rows = await deps.list({ ...options, workspaceId });
    return {
      items: rows
        .slice(0, options.limit)
        .map((entry) => project(entry, options.fields)),
      page: {
        limit: options.limit,
        offset: options.offset,
        hasMore: rows.length > options.limit,
      },
    };
  };
}

export function createHandleDeliveryGetById(deps: ContentDeliveryHandlerDeps) {
  return async (
    options: ContentDeliveryEntryOptions,
    ctx: ActionContext,
  ): Promise<{ entry: DeliveryEntry }> => {
    const workspaceId = z.string().uuid().parse(ctx.workspaceId);
    const entry = await deps.get({ ...options, workspaceId });
    if (!entry)
      throw new DomainError(
        "Published content unavailable",
        "ENTRY_NOT_FOUND",
        404,
      );
    return { entry: project(entry, options.fields) };
  };
}

const deliveryDeps: ContentDeliveryHandlerDeps = {
  list: listDeliveryEntries,
  get: getDeliveryEntry,
};
export const handleDeliveryListByDirectory =
  createHandleDeliveryListByDirectory(deliveryDeps);
export const handleDeliveryGetById = createHandleDeliveryGetById(deliveryDeps);
