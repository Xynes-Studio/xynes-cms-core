import { z } from "zod";
import { findContentDirectoryByIdAndWorkspace } from "../../infra/db/repositories/content-directory.repository";
import {
  type ContentEntry,
  type ContentEntryData,
  createEntry,
  findEntryByIdAndWorkspace,
  listEntriesByDirectory,
  listEntryCollaboratorsByEntryIds,
  listFavoriteEntryIdsByUser,
  listFavoritedEntriesByUser,
  publishEntryByIdAndWorkspace,
  replaceEntryCollaborators,
  setEntryStatusByIdAndWorkspace,
  softDeleteEntryByIdAndWorkspace,
  toggleEntryFavorite,
  updateEntryByIdAndWorkspaceScoped,
} from "../../infra/db/repositories/content-entry.repository";
import { findContentTypeByTemplateKey } from "../../infra/db/repositories/content-type.repository";
import {
  ContentTypeNotFoundError,
  EntryNotFoundError,
  ValidationError,
} from "../errors";
import type { ActionContext } from "../types";
import { handleContentTypeEnsureDefaults } from "./content-type-ensure-defaults.handler";

function normalizeJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return {};
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
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

function safeMergeEntryData(
  existing: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const blocked = new Set(["__proto__", "prototype", "constructor"]);
  const merged: Record<string, unknown> = { ...existing };
  for (const [key, value] of Object.entries(patch)) {
    if (blocked.has(key)) continue;
    merged[key] = value;
  }
  return merged;
}

function requireUserId(ctx: ActionContext): string {
  if (!ctx.userId) {
    throw new ValidationError("User context is required for this action");
  }
  return ctx.userId;
}

function mapEntry(
  entry: ContentEntry,
  options: {
    collaborators?: string[];
    isFavorite?: boolean;
  } = {},
) {
  const data = normalizeJsonObject(entry.data);
  const tagsValue = data.tags;
  const tags = Array.isArray(tagsValue)
    ? tagsValue.filter((tag): tag is string => typeof tag === "string")
    : [];

  return {
    id: entry.id,
    workspaceId: entry.workspaceId,
    contentTypeId: entry.contentTypeId,
    directoryId: entry.directoryId,
    title: typeof data.title === "string" ? data.title : "",
    description: typeof data.description === "string" ? data.description : "",
    body: data.body,
    tags,
    ownerName: typeof data.ownerName === "string" ? data.ownerName : null,
    avatarUrl: typeof data.avatarUrl === "string" ? data.avatarUrl : null,
    status: entry.status,
    publishedAt: entry.publishedAt,
    createdBy: entry.createdBy,
    updatedBy: entry.updatedBy,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    collaborators: options.collaborators ?? [],
    isFavorite: options.isFavorite ?? false,
  };
}

function mapCollaboratorNames(
  rows: Array<{ userId: string; displayName: string | null }> | undefined,
): string[] {
  if (!rows?.length) return [];
  return rows.map((row) => row.displayName?.trim() || row.userId);
}

function createEntrySlugFromTitle(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 200)
    .replace(/^-+|-+$/g, "");

  return slug || "entry";
}

export const EntryCreatePayloadSchema = z
  .object({
    directoryId: z.string().uuid().nullable().optional(),
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(4000).optional(),
    body: z.record(z.string(), z.unknown()).optional(),
    tags: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
    ownerName: z.string().trim().min(1).max(120).optional(),
    avatarUrl: z.string().url().optional(),
    publishNow: z.boolean().optional(),
  })
  .strict();

export type EntryCreatePayload = z.infer<typeof EntryCreatePayloadSchema>;

export const EntryUpdatePayloadSchema = z
  .object({
    entryId: z.string().uuid(),
    directoryId: z.string().uuid().nullable().optional(),
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(4000).optional(),
    body: z.record(z.string(), z.unknown()).optional(),
    tags: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
    ownerName: z.string().trim().min(1).max(120).optional(),
    avatarUrl: z.string().url().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasAnyField =
      value.directoryId !== undefined ||
      value.title !== undefined ||
      value.description !== undefined ||
      value.body !== undefined ||
      value.tags !== undefined ||
      value.ownerName !== undefined ||
      value.avatarUrl !== undefined;
    if (!hasAnyField) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one updatable field is required",
      });
    }
  });

export type EntryUpdatePayload = z.infer<typeof EntryUpdatePayloadSchema>;

export const EntryDeletePayloadSchema = z
  .object({
    entryId: z.string().uuid(),
  })
  .strict();

export type EntryDeletePayload = z.infer<typeof EntryDeletePayloadSchema>;

export const EntryPublishPayloadSchema = z
  .object({
    entryId: z.string().uuid(),
  })
  .strict();

export type EntryPublishPayload = z.infer<typeof EntryPublishPayloadSchema>;

const EntryStatusSchema = z.enum([
  "draft",
  "scheduled",
  "published",
  "archived",
]);

export const EntryStatusSetPayloadSchema = z
  .object({
    entryId: z.string().uuid(),
    status: EntryStatusSchema,
    publishAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.status === "scheduled") {
      if (!value.publishAt) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "publishAt is required when scheduling an entry",
          path: ["publishAt"],
        });
        return;
      }

      const publishAt = new Date(value.publishAt);
      if (Number.isNaN(publishAt.getTime())) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "publishAt must be a valid ISO8601 datetime",
          path: ["publishAt"],
        });
        return;
      }

      if (publishAt.getTime() <= Date.now()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "publishAt must be in the future",
          path: ["publishAt"],
        });
      }

      return;
    }

    if (value.publishAt !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "publishAt is only allowed when status is scheduled",
        path: ["publishAt"],
      });
    }
  });

export type EntryStatusSetPayload = z.infer<typeof EntryStatusSetPayloadSchema>;

export const EntryListByDirectoryPayloadSchema = z
  .object({
    directoryId: z.string().uuid().nullable().optional(),
    search: z.string().trim().min(1).max(200).optional(),
    sortBy: z.enum(["date", "title", "popularity"]).optional().default("date"),
    sortDirection: z.enum(["asc", "desc"]).optional().default("desc"),
    status: z
      .enum(["draft", "scheduled", "published", "archived", "all"])
      .optional()
      .default("all"),
    limit: z.number().int().min(1).max(100).optional().default(20),
    offset: z.number().int().min(0).optional().default(0),
  })
  .strict();

export type EntryListByDirectoryPayload = z.infer<
  typeof EntryListByDirectoryPayloadSchema
>;

export const EntryGetByIdPayloadSchema = z
  .object({
    entryId: z.string().uuid(),
  })
  .strict();

export type EntryGetByIdPayload = z.infer<typeof EntryGetByIdPayloadSchema>;

export const EntryCollaboratorsSetPayloadSchema = z
  .object({
    entryId: z.string().uuid(),
    collaborators: z
      .array(
        z
          .object({
            userId: z.string().uuid(),
            displayName: z.string().trim().min(1).max(120).optional(),
          })
          .strict(),
      )
      .max(50),
  })
  .strict()
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    for (const collaborator of value.collaborators) {
      if (seen.has(collaborator.userId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Collaborator user IDs must be unique",
          path: ["collaborators"],
        });
        return;
      }
      seen.add(collaborator.userId);
    }
  });

export type EntryCollaboratorsSetPayload = z.infer<
  typeof EntryCollaboratorsSetPayloadSchema
>;

export const EntryFavoriteTogglePayloadSchema = z
  .object({
    entryId: z.string().uuid(),
  })
  .strict();

export type EntryFavoriteTogglePayload = z.infer<
  typeof EntryFavoriteTogglePayloadSchema
>;

export const EntryFavoriteListPayloadSchema = z
  .object({
    limit: z.number().int().min(1).max(100).optional().default(20),
    offset: z.number().int().min(0).optional().default(0),
  })
  .strict();

export type EntryFavoriteListPayload = z.infer<
  typeof EntryFavoriteListPayloadSchema
>;

export const EntryShareGenerateInternalLinkPayloadSchema = z
  .object({
    entryId: z.string().uuid(),
    workspaceSlug: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9-]+$/i),
  })
  .strict();

export type EntryShareGenerateInternalLinkPayload = z.infer<
  typeof EntryShareGenerateInternalLinkPayloadSchema
>;

export interface EntryManagementDeps {
  createEntry: typeof createEntry;
  findContentTypeByTemplateKey: typeof findContentTypeByTemplateKey;
  ensureContentTypeDefaults: typeof handleContentTypeEnsureDefaults;
  findContentDirectoryByIdAndWorkspace: typeof findContentDirectoryByIdAndWorkspace;
  findEntryByIdAndWorkspace: typeof findEntryByIdAndWorkspace;
  updateEntryByIdAndWorkspaceScoped: typeof updateEntryByIdAndWorkspaceScoped;
  softDeleteEntryByIdAndWorkspace: typeof softDeleteEntryByIdAndWorkspace;
  publishEntryByIdAndWorkspace: typeof publishEntryByIdAndWorkspace;
  setEntryStatusByIdAndWorkspace: typeof setEntryStatusByIdAndWorkspace;
  listEntriesByDirectory: typeof listEntriesByDirectory;
  listEntryCollaboratorsByEntryIds: typeof listEntryCollaboratorsByEntryIds;
  replaceEntryCollaborators: typeof replaceEntryCollaborators;
  toggleEntryFavorite: typeof toggleEntryFavorite;
  listFavoriteEntryIdsByUser: typeof listFavoriteEntryIdsByUser;
  listFavoritedEntriesByUser: typeof listFavoritedEntriesByUser;
}

const entryManagementDeps: EntryManagementDeps = {
  createEntry,
  findContentTypeByTemplateKey,
  ensureContentTypeDefaults: handleContentTypeEnsureDefaults,
  findContentDirectoryByIdAndWorkspace,
  findEntryByIdAndWorkspace,
  updateEntryByIdAndWorkspaceScoped,
  softDeleteEntryByIdAndWorkspace,
  publishEntryByIdAndWorkspace,
  setEntryStatusByIdAndWorkspace,
  listEntriesByDirectory,
  listEntryCollaboratorsByEntryIds,
  replaceEntryCollaborators,
  toggleEntryFavorite,
  listFavoriteEntryIdsByUser,
  listFavoritedEntriesByUser,
};

const defaultEntryContentTypeTemplateKey = "blog_post";

export function createHandleEntryCreate(deps: EntryManagementDeps) {
  return async function handleEntryCreate(
    payload: EntryCreatePayload,
    ctx: ActionContext,
  ) {
    let contentType = await deps.findContentTypeByTemplateKey(
      defaultEntryContentTypeTemplateKey,
      ctx.workspaceId,
    );

    if (!contentType) {
      await deps.ensureContentTypeDefaults(
        { templateKeys: [defaultEntryContentTypeTemplateKey] },
        ctx,
      );

      contentType = await deps.findContentTypeByTemplateKey(
        defaultEntryContentTypeTemplateKey,
        ctx.workspaceId,
      );
    }

    if (!contentType) {
      throw new ContentTypeNotFoundError(defaultEntryContentTypeTemplateKey);
    }

    if (payload.directoryId) {
      const directory = await deps.findContentDirectoryByIdAndWorkspace(
        payload.directoryId,
        ctx.workspaceId,
      );
      if (!directory) {
        throw new ValidationError("Directory was not found");
      }
    }

    const status = payload.publishNow ? "published" : "draft";
    const publishedAt = payload.publishNow ? new Date() : null;
    const slug = createEntrySlugFromTitle(payload.title);

    const entry = await deps.createEntry({
      workspaceId: ctx.workspaceId,
      contentTypeId: contentType.id,
      directoryId: payload.directoryId ?? null,
      status,
      publishedAt,
      createdBy: ctx.userId ?? null,
      updatedBy: ctx.userId ?? null,
      data: {
        slug,
        title: payload.title,
        description: payload.description ?? "",
        body: payload.body,
        tags: payload.tags ?? [],
        ownerName: payload.ownerName ?? null,
        avatarUrl: payload.avatarUrl ?? null,
        popularityScore: 0,
      },
    });

    return {
      entry: mapEntry(entry),
    };
  };
}

export function createHandleEntryUpdate(deps: EntryManagementDeps) {
  return async function handleEntryUpdate(
    payload: EntryUpdatePayload,
    ctx: ActionContext,
  ) {
    const current = await deps.findEntryByIdAndWorkspace(
      payload.entryId,
      ctx.workspaceId,
    );
    if (!current) {
      throw new EntryNotFoundError(payload.entryId);
    }

    if (payload.directoryId) {
      const directory = await deps.findContentDirectoryByIdAndWorkspace(
        payload.directoryId,
        ctx.workspaceId,
      );
      if (!directory) {
        throw new ValidationError("Directory was not found");
      }
    }

    const existingData = normalizeJsonObject(current.data);
    const patch = {
      ...(payload.title !== undefined ? { title: payload.title } : {}),
      ...(payload.description !== undefined
        ? { description: payload.description }
        : {}),
      ...(payload.body !== undefined ? { body: payload.body } : {}),
      ...(payload.tags !== undefined ? { tags: payload.tags } : {}),
      ...(payload.ownerName !== undefined
        ? { ownerName: payload.ownerName }
        : {}),
      ...(payload.avatarUrl !== undefined
        ? { avatarUrl: payload.avatarUrl }
        : {}),
    };

    const updatedData = safeMergeEntryData(
      existingData,
      patch,
    ) as ContentEntryData;
    const updated = await deps.updateEntryByIdAndWorkspaceScoped({
      entryId: payload.entryId,
      workspaceId: ctx.workspaceId,
      data: updatedData,
      ...(payload.directoryId !== undefined
        ? { directoryId: payload.directoryId }
        : {}),
      updatedBy: ctx.userId ?? null,
    });

    if (!updated) {
      throw new EntryNotFoundError(payload.entryId);
    }

    return {
      entry: mapEntry(updated),
    };
  };
}

export function createHandleEntryDelete(deps: EntryManagementDeps) {
  return async function handleEntryDelete(
    payload: EntryDeletePayload,
    ctx: ActionContext,
  ) {
    const actorUserId = requireUserId(ctx);
    const deleted = await deps.softDeleteEntryByIdAndWorkspace({
      entryId: payload.entryId,
      workspaceId: ctx.workspaceId,
      deletedBy: actorUserId,
    });

    if (!deleted) {
      throw new EntryNotFoundError(payload.entryId);
    }

    return {
      success: true,
      entryId: deleted.id,
      deletedAt: deleted.deletedAt,
      deletedBy: deleted.deletedBy,
    };
  };
}

export function createHandleEntryPublish(deps: EntryManagementDeps) {
  return async function handleEntryPublish(
    payload: EntryPublishPayload,
    ctx: ActionContext,
  ) {
    const updated = await deps.setEntryStatusByIdAndWorkspace({
      entryId: payload.entryId,
      workspaceId: ctx.workspaceId,
      status: "published",
      publishedAt: undefined,
      updatedBy: ctx.userId ?? null,
    });

    if (!updated) {
      throw new EntryNotFoundError(payload.entryId);
    }

    return {
      entry: mapEntry(updated),
    };
  };
}

export function createHandleEntryStatusSet(deps: EntryManagementDeps) {
  return async function handleEntryStatusSet(
    payload: EntryStatusSetPayload,
    ctx: ActionContext,
  ) {
    if (payload.status === "scheduled") {
      const current = await deps.findEntryByIdAndWorkspace(
        payload.entryId,
        ctx.workspaceId,
      );
      if (!current) {
        throw new EntryNotFoundError(payload.entryId);
      }
      if (current.status === "published") {
        throw new ValidationError(
          "Published entries cannot be scheduled without a draft revision",
        );
      }
    }

    const updated = await deps.setEntryStatusByIdAndWorkspace({
      entryId: payload.entryId,
      workspaceId: ctx.workspaceId,
      status: payload.status,
      publishedAt:
        payload.status === "scheduled" && payload.publishAt
          ? new Date(payload.publishAt)
          : undefined,
      updatedBy: ctx.userId ?? null,
    });

    if (!updated) {
      throw new EntryNotFoundError(payload.entryId);
    }

    return {
      entry: mapEntry(updated),
    };
  };
}

export function createHandleEntryListByDirectory(deps: EntryManagementDeps) {
  return async function handleEntryListByDirectory(
    payload: EntryListByDirectoryPayload,
    ctx: ActionContext,
  ) {
    const statusFilter = payload.status === "all" ? undefined : payload.status;
    const entries = await deps.listEntriesByDirectory({
      workspaceId: ctx.workspaceId,
      directoryId: payload.directoryId,
      status: statusFilter,
      search: payload.search,
      sortBy: payload.sortBy,
      sortDirection: payload.sortDirection,
      limit: payload.limit,
      offset: payload.offset,
    });

    const entryIds = entries.map((entry) => entry.id);
    const collaboratorsByEntry = await deps.listEntryCollaboratorsByEntryIds({
      workspaceId: ctx.workspaceId,
      entryIds,
    });
    const favoriteIds = ctx.userId
      ? await deps.listFavoriteEntryIdsByUser({
          workspaceId: ctx.workspaceId,
          userId: ctx.userId,
        })
      : new Set<string>();

    const items = entries.map((entry) =>
      mapEntry(entry, {
        collaborators: mapCollaboratorNames(collaboratorsByEntry.get(entry.id)),
        isFavorite: favoriteIds.has(entry.id),
      }),
    );

    return {
      items,
      count: items.length,
    };
  };
}

export function createHandleEntryGetById(deps: EntryManagementDeps) {
  return async function handleEntryGetById(
    payload: EntryGetByIdPayload,
    ctx: ActionContext,
  ) {
    const entry = await deps.findEntryByIdAndWorkspace(
      payload.entryId,
      ctx.workspaceId,
    );
    if (!entry) {
      throw new EntryNotFoundError(payload.entryId);
    }

    const collaboratorsByEntry = await deps.listEntryCollaboratorsByEntryIds({
      workspaceId: ctx.workspaceId,
      entryIds: [entry.id],
    });
    const favoriteIds = ctx.userId
      ? await deps.listFavoriteEntryIdsByUser({
          workspaceId: ctx.workspaceId,
          userId: ctx.userId,
        })
      : new Set<string>();

    return {
      entry: mapEntry(entry, {
        collaborators: mapCollaboratorNames(collaboratorsByEntry.get(entry.id)),
        isFavorite: favoriteIds.has(entry.id),
      }),
    };
  };
}

export function createHandleEntryCollaboratorsSet(deps: EntryManagementDeps) {
  return async function handleEntryCollaboratorsSet(
    payload: EntryCollaboratorsSetPayload,
    ctx: ActionContext,
  ) {
    const entry = await deps.findEntryByIdAndWorkspace(
      payload.entryId,
      ctx.workspaceId,
    );
    if (!entry) {
      throw new EntryNotFoundError(payload.entryId);
    }

    const collaborators = await deps.replaceEntryCollaborators({
      workspaceId: ctx.workspaceId,
      entryId: payload.entryId,
      collaborators: payload.collaborators,
    });

    return {
      entryId: payload.entryId,
      collaborators: collaborators.map(
        (collaborator) =>
          collaborator.displayName?.trim() || collaborator.userId,
      ),
    };
  };
}

export function createHandleEntryFavoriteToggle(deps: EntryManagementDeps) {
  return async function handleEntryFavoriteToggle(
    payload: EntryFavoriteTogglePayload,
    ctx: ActionContext,
  ) {
    const actorUserId = requireUserId(ctx);
    const entry = await deps.findEntryByIdAndWorkspace(
      payload.entryId,
      ctx.workspaceId,
    );
    if (!entry) {
      throw new EntryNotFoundError(payload.entryId);
    }

    const toggled = await deps.toggleEntryFavorite({
      workspaceId: ctx.workspaceId,
      entryId: payload.entryId,
      userId: actorUserId,
    });

    return {
      entryId: payload.entryId,
      isFavorite: toggled.isFavorite,
    };
  };
}

export function createHandleEntryFavoriteList(deps: EntryManagementDeps) {
  return async function handleEntryFavoriteList(
    payload: EntryFavoriteListPayload,
    ctx: ActionContext,
  ) {
    const actorUserId = requireUserId(ctx);
    const entries = await deps.listFavoritedEntriesByUser({
      workspaceId: ctx.workspaceId,
      userId: actorUserId,
      limit: payload.limit,
      offset: payload.offset,
    });

    const collaboratorsByEntry = await deps.listEntryCollaboratorsByEntryIds({
      workspaceId: ctx.workspaceId,
      entryIds: entries.map((entry) => entry.id),
    });

    return {
      items: entries.map((entry) =>
        mapEntry(entry, {
          collaborators: mapCollaboratorNames(
            collaboratorsByEntry.get(entry.id),
          ),
          isFavorite: true,
        }),
      ),
      count: entries.length,
    };
  };
}

export function createHandleEntryShareGenerateInternalLink(
  deps: EntryManagementDeps,
) {
  return async function handleEntryShareGenerateInternalLink(
    payload: EntryShareGenerateInternalLinkPayload,
    ctx: ActionContext,
  ) {
    const entry = await deps.findEntryByIdAndWorkspace(
      payload.entryId,
      ctx.workspaceId,
    );
    if (!entry) {
      throw new EntryNotFoundError(payload.entryId);
    }

    return {
      url: `/dashboard/${encodeURIComponent(
        payload.workspaceSlug,
      )}/content/entry/${entry.id}/edit`,
    };
  };
}

export const handleEntryCreate = createHandleEntryCreate(entryManagementDeps);
export const handleEntryUpdate = createHandleEntryUpdate(entryManagementDeps);
export const handleEntryDelete = createHandleEntryDelete(entryManagementDeps);
export const handleEntryPublish = createHandleEntryPublish(entryManagementDeps);
export const handleEntryStatusSet =
  createHandleEntryStatusSet(entryManagementDeps);
export const handleEntryListByDirectory =
  createHandleEntryListByDirectory(entryManagementDeps);
export const handleEntryGetById = createHandleEntryGetById(entryManagementDeps);
export const handleEntryCollaboratorsSet =
  createHandleEntryCollaboratorsSet(entryManagementDeps);
export const handleEntryFavoriteToggle =
  createHandleEntryFavoriteToggle(entryManagementDeps);
export const handleEntryFavoriteList =
  createHandleEntryFavoriteList(entryManagementDeps);
export const handleEntryShareGenerateInternalLink =
  createHandleEntryShareGenerateInternalLink(entryManagementDeps);
