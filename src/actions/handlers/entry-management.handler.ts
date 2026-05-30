import { z } from "zod";
import { findContentDirectoryByIdAndWorkspace } from "../../infra/db/repositories/content-directory.repository";
import {
  type ContentEntry,
  type ContentEntryData,
  createEntry,
  findEntryByIdAndWorkspace,
  listEntriesByDirectory,
  listEntryCollaboratorsByEntryIds,
  listEntryCreatorsByUserIds,
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
  getOptionalUserId,
  requireUserActor,
} from "../../middleware/actor-guards";
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

function mapEntry(
  entry: ContentEntry,
  options: {
    collaborators?: string[];
    isFavorite?: boolean;
    creator?: { id: string; displayName: string | null } | null;
  } = {},
) {
  const data = normalizeJsonObject(entry.data);
  const tagsValue = data.tags;
  const tags = Array.isArray(tagsValue)
    ? tagsValue.filter((tag): tag is string => typeof tag === "string")
    : [];

  // BUG-CMS-8: surface a structured `creator` field on every entry.
  //
  // Contract:
  //   - `creator === null` <=>  `created_by IS NULL` in the DB row.
  //     Per the CMS-API-KEY-ACTOR-1 Story C audit policy, that happens
  //     exactly when an `api_key` actor created the entry (the column
  //     FKs `identity.users` and `api_key` actors carry no user id).
  //     Frontends MUST render an "API key" / "via API key" label here
  //     and MUST NOT leak the key id, key prefix, or any other internal
  //     audit field through the visible owner slot.
  //   - `creator !== null` => the entry was created by a real human user.
  //     `creator.id` is the `identity.users.id` UUID; `creator.displayName`
  //     is the value from `identity.users.display_name`, which may be
  //     `null` (the column is nullable). UI fallbacks for the null-name
  //     case stay in the frontend so we don't bake product copy into the
  //     API surface here.
  //   - When `created_by` is a UUID but no `identity.users` row matches
  //     (e.g. the source user was deleted under the FK's
  //     `ON DELETE SET NULL` cascade — that path actually flips
  //     `created_by` to NULL, but a future cascade-less path could leave
  //     a dangling UUID), we surface `{ id, displayName: null }` instead
  //     of `null` so the UI doesn't mis-attribute the entry to "API key".
  //
  // `created_by` itself stays OFF this DTO so we don't leak raw user
  // UUIDs to clients that have no business reading them.
  const creator =
    options.creator === undefined
      ? entry.createdBy
        ? { id: entry.createdBy, displayName: null }
        : null
      : options.creator;

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
    creator,
  };
}

function mapCollaboratorNames(
  rows: Array<{ userId: string; displayName: string | null }> | undefined,
): string[] {
  if (!rows?.length) return [];
  return rows.map((row) => row.displayName?.trim() || row.userId);
}

// BUG-CMS-8: collapse a row's `created_by` UUID + the batch `identity.users`
// lookup into the structured `creator` shape that `mapEntry` consumes.
//
// Branch table (`createdBy`, `identityUsers` row):
//   - (null, *)         -> `null`              (api_key actor — Story C contract)
//   - (uuid, found)     -> { id, displayName } (real human creator)
//   - (uuid, missing)   -> { id, displayName: null } (orphan UUID — defense
//                                                    against future paths that
//                                                    don't ON DELETE SET NULL)
function resolveCreator(
  createdBy: string | null,
  creatorsById: Map<string, { id: string; displayName: string | null }>,
): { id: string; displayName: string | null } | null {
  if (!createdBy) {
    return null;
  }
  const found = creatorsById.get(createdBy);
  if (found) {
    return { id: found.id, displayName: found.displayName };
  }
  return { id: createdBy, displayName: null };
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
  listEntryCreatorsByUserIds: typeof listEntryCreatorsByUserIds;
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
  listEntryCreatorsByUserIds,
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

    // CMS-API-KEY-ACTOR-1 (Story C): in-preset action `cms.entry.create`
    // accepts either actor kind. For an `api_key` actor we deliberately
    // write `createdBy`/`updatedBy = NULL` rather than a synthetic UUID
    // because the column FKs `identity.users` and the api_key actor has
    // no human user identity. Actor attribution for audit is preserved
    // out-of-band by the gateway telemetry pipeline (Task 5 of the
    // gateway API-key plan emits `actorType`, `apiKeyId`, `keyPrefix`).
    const auditUserId = getOptionalUserId(ctx);

    const entry = await deps.createEntry({
      workspaceId: ctx.workspaceId,
      contentTypeId: contentType.id,
      directoryId: payload.directoryId ?? null,
      status,
      publishedAt,
      createdBy: auditUserId,
      updatedBy: auditUserId,
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
    // CMS-API-KEY-ACTOR-1 (Story C): explicitly write `updatedBy` on
    // every update — `null` for `api_key` actors so the column is
    // refreshed (not left stale at the prior writer's id). The repo
    // distinguishes `undefined` (do not touch) from `null` (set to
    // NULL); we always pass a value so the audit signal is unambiguous.
    const updated = await deps.updateEntryByIdAndWorkspaceScoped({
      entryId: payload.entryId,
      workspaceId: ctx.workspaceId,
      data: updatedData,
      ...(payload.directoryId !== undefined
        ? { directoryId: payload.directoryId }
        : {}),
      updatedBy: getOptionalUserId(ctx),
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
    // CMS-API-KEY-ACTOR-1 (Story C): `cms.entry.delete` is NOT in any
    // MVP API key preset (`cms_authoring` / `cms_publisher` /
    // `cms_readonly`), so the gateway scope check already 403s any
    // api_key caller. This guard is the handler-side belt-and-braces:
    // if a future preset accidentally includes this scope the handler
    // still refuses with a stable `FORBIDDEN_ACTOR_KIND` code instead
    // of attempting an unattributable soft-delete.
    const actorUserId = requireUserActor(ctx);
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
    // CMS-API-KEY-ACTOR-1 (Story C): in-preset action `cms.entry.publish`
    // (gated by `cms_publisher` preset). Always write `updatedBy`
    // explicitly — `null` for an `api_key` actor — so the publish event
    // is honestly attributed.
    const updated = await deps.setEntryStatusByIdAndWorkspace({
      entryId: payload.entryId,
      workspaceId: ctx.workspaceId,
      status: "published",
      publishedAt: undefined,
      updatedBy: getOptionalUserId(ctx),
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

    // CMS-API-KEY-ACTOR-1 (Story C): in-preset action `cms.entry.status.set`
    // (gated by `cms_publisher` preset). Same audit policy as publish.
    const updated = await deps.setEntryStatusByIdAndWorkspace({
      entryId: payload.entryId,
      workspaceId: ctx.workspaceId,
      status: payload.status,
      publishedAt:
        payload.status === "scheduled" && payload.publishAt
          ? new Date(payload.publishAt)
          : undefined,
      updatedBy: getOptionalUserId(ctx),
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

    // BUG-CMS-8: batch the `identity.users` lookup for every distinct
    // creator UUID across this page of entries so each row carries a
    // structured `creator` field instead of just the raw `created_by`
    // UUID. The favourites flag on each item still derives from the
    // per-user `favoriteIds` set fetched above — directory lists must
    // preserve mixed favourite / non-favourite state.
    const creatorIds = Array.from(
      new Set(
        entries
          .map((entry) => entry.createdBy)
          .filter(
            (id): id is string => typeof id === "string" && id.length > 0,
          ),
      ),
    );
    const creatorsById = creatorIds.length
      ? await deps.listEntryCreatorsByUserIds({ userIds: creatorIds })
      : new Map<string, { id: string; displayName: string | null }>();

    return {
      items: entries.map((entry) =>
        mapEntry(entry, {
          collaborators: mapCollaboratorNames(
            collaboratorsByEntry.get(entry.id),
          ),
          isFavorite: favoriteIds.has(entry.id),
          creator: resolveCreator(entry.createdBy, creatorsById),
        }),
      ),
      count: entries.length,
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
    // BUG-CMS-8: surface a single-entry creator lookup so detail views
    // (CMS dashboard entry header, future editor metadata panel) see the
    // same shape as the list path.
    const creatorsById = entry.createdBy
      ? await deps.listEntryCreatorsByUserIds({ userIds: [entry.createdBy] })
      : new Map<string, { id: string; displayName: string | null }>();

    return {
      entry: mapEntry(entry, {
        collaborators: mapCollaboratorNames(collaboratorsByEntry.get(entry.id)),
        isFavorite: favoriteIds.has(entry.id),
        creator: resolveCreator(entry.createdBy, creatorsById),
      }),
    };
  };
}

export function createHandleEntryCollaboratorsSet(deps: EntryManagementDeps) {
  return async function handleEntryCollaboratorsSet(
    payload: EntryCollaboratorsSetPayload,
    ctx: ActionContext,
  ) {
    // CMS-API-KEY-ACTOR-1 (Story C): `cms.entry.collaborators.set` is
    // NOT in any MVP preset. Refuse api_key actors at the handler
    // boundary with 403 FORBIDDEN_ACTOR_KIND.
    requireUserActor(ctx);
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
    // CMS-API-KEY-ACTOR-1 (Story C): favorites are inherently per-user;
    // an api_key actor has no user identity to scope the toggle on.
    const actorUserId = requireUserActor(ctx);
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
    // CMS-API-KEY-ACTOR-1 (Story C): same rationale as favorite.toggle —
    // the favorites list is per-user.
    const actorUserId = requireUserActor(ctx);
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

    // BUG-CMS-8: thread the same creator lookup through the favourites
    // list so the favourites tab in the CMS Console renders the same
    // owner names as the directory list. Without this, every favourited
    // entry would surface as `{ id: createdBy, displayName: null }` and
    // the UI would render an empty / fallback owner label even though
    // the real creator name is available.
    const creatorIds = Array.from(
      new Set(
        entries
          .map((entry) => entry.createdBy)
          .filter(
            (id): id is string => typeof id === "string" && id.length > 0,
          ),
      ),
    );
    const creatorsById = creatorIds.length
      ? await deps.listEntryCreatorsByUserIds({ userIds: creatorIds })
      : new Map<string, { id: string; displayName: string | null }>();

    return {
      items: entries.map((entry) =>
        mapEntry(entry, {
          collaborators: mapCollaboratorNames(
            collaboratorsByEntry.get(entry.id),
          ),
          isFavorite: true,
          creator: resolveCreator(entry.createdBy, creatorsById),
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
    // CMS-API-KEY-ACTOR-1 (Story C): share-link generation is a
    // dashboard-only convenience and out of every MVP preset.
    requireUserActor(ctx);
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
