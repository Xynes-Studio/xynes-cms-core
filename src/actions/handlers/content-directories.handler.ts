import { z } from "zod";
import {
  createContentDirectory,
  deleteContentDirectorySubtreeByIdAndWorkspace,
  findContentDirectoryByIdAndWorkspace,
  findContentDirectoryByWorkspaceParentAndPathSegment,
  listContentDirectoriesForWorkspace,
  updateContentDirectoryByIdAndWorkspace,
  withRootContentDirectoryPathMutex,
} from "../../infra/db/repositories/content-directory.repository";
import { requireUserActor } from "../../middleware/actor-guards";
import { ValidationError } from "../errors";
import type { ActionContext } from "../types";

const routePathParentPrefix = "content-path-";
const uuidV4LikePattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuidLike(value: string) {
  return uuidV4LikePattern.test(value);
}

function normalizePathSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const isUniqueViolationError = (value: unknown) =>
  typeof value === "object" &&
  value !== null &&
  "code" in value &&
  value.code === "23505";

export const ContentDirectoriesListForWorkspacePayloadSchema = z
  .object({})
  .strict();

export type ContentDirectoriesListForWorkspacePayload = z.infer<
  typeof ContentDirectoriesListForWorkspacePayloadSchema
>;

export const ContentDirectoriesCreatePayloadSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    parentId: z.string().trim().min(1).max(160).nullable().optional(),
  })
  .strict();

export type ContentDirectoriesCreatePayload = z.infer<
  typeof ContentDirectoriesCreatePayloadSchema
>;

export const ContentDirectoriesUpdatePayloadSchema = z
  .object({
    directoryId: z.string().trim().min(1).max(160),
    name: z.string().trim().min(1).max(80),
  })
  .strict();

export type ContentDirectoriesUpdatePayload = z.infer<
  typeof ContentDirectoriesUpdatePayloadSchema
>;

export const ContentDirectoriesDeletePayloadSchema = z
  .object({
    directoryId: z.string().trim().min(1).max(160),
  })
  .strict();

export type ContentDirectoriesDeletePayload = z.infer<
  typeof ContentDirectoriesDeletePayloadSchema
>;

export interface ContentDirectoryDTO {
  id: string;
  parentId: string | null;
  name: string;
  pathSegment: string;
}

export interface ContentDirectoriesListForWorkspaceDeps {
  listContentDirectoriesForWorkspace: typeof listContentDirectoriesForWorkspace;
}

export interface ContentDirectoriesCreateDeps {
  createContentDirectory: typeof createContentDirectory;
  findContentDirectoryByIdAndWorkspace: typeof findContentDirectoryByIdAndWorkspace;
  findContentDirectoryByWorkspaceParentAndPathSegment: typeof findContentDirectoryByWorkspaceParentAndPathSegment;
  withRootContentDirectoryPathMutex?: <T>(input: {
    workspaceId: string;
    pathSegment: string;
    run: () => Promise<T>;
  }) => Promise<T>;
}

export interface ContentDirectoriesUpdateDeps {
  findContentDirectoryByIdAndWorkspace: typeof findContentDirectoryByIdAndWorkspace;
  findContentDirectoryByWorkspaceParentAndPathSegment: typeof findContentDirectoryByWorkspaceParentAndPathSegment;
  updateContentDirectoryByIdAndWorkspace: typeof updateContentDirectoryByIdAndWorkspace;
}

export interface ContentDirectoriesDeleteDeps {
  findContentDirectoryByIdAndWorkspace: typeof findContentDirectoryByIdAndWorkspace;
  deleteContentDirectorySubtreeByIdAndWorkspace: typeof deleteContentDirectorySubtreeByIdAndWorkspace;
}

export function createHandleContentDirectoriesListForWorkspace(
  deps: ContentDirectoriesListForWorkspaceDeps,
) {
  return async function handleContentDirectoriesListForWorkspace(
    _payload: ContentDirectoriesListForWorkspacePayload,
    ctx: ActionContext,
  ): Promise<ContentDirectoryDTO[]> {
    // CMS-API-KEY-ACTOR-1 (Story C): directory operations are NOT in
    // any MVP API key preset. Refuse api_key actors at the handler
    // boundary so a misconfigured future preset cannot silently
    // expose the directory tree to an integration key.
    requireUserActor(ctx);

    const rows = await deps.listContentDirectoriesForWorkspace(ctx.workspaceId);
    return rows.map((row) => ({
      id: row.id,
      parentId: row.parentId,
      name: row.name,
      pathSegment: row.pathSegment,
    }));
  };
}

function normalizeParentId(parentId: string | null | undefined): string | null {
  if (!parentId) {
    return null;
  }

  const trimmed = parentId.trim();
  return trimmed.length ? trimmed : null;
}

async function assertParentIsAllowed({
  parentId,
  workspaceId,
  deps,
}: {
  parentId: string | null;
  workspaceId: string;
  deps: ContentDirectoriesCreateDeps;
}) {
  if (!parentId) {
    return;
  }

  if (parentId.startsWith(routePathParentPrefix)) {
    throw new ValidationError(
      "Route-derived directories cannot be used as persistent parent directories",
    );
  }

  if (isUuidLike(parentId)) {
    const parentDirectory = await deps.findContentDirectoryByIdAndWorkspace(
      parentId,
      workspaceId,
    );
    if (!parentDirectory) {
      throw new ValidationError("Parent directory was not found");
    }
    return;
  }

  throw new ValidationError("Invalid parentId");
}

export function createHandleContentDirectoriesCreate(
  deps: ContentDirectoriesCreateDeps,
) {
  const runWithinRootPathMutex =
    deps.withRootContentDirectoryPathMutex ??
    (async <T>({ run }: { run: () => Promise<T> }) => await run());

  return async function handleContentDirectoriesCreate(
    payload: ContentDirectoriesCreatePayload,
    ctx: ActionContext,
  ): Promise<ContentDirectoryDTO> {
    // CMS-API-KEY-ACTOR-1 (Story C): directory writes are NOT in any
    // MVP API key preset. Reject api_key callers with 403
    // FORBIDDEN_ACTOR_KIND at the handler boundary.
    requireUserActor(ctx);
    const workspaceId = ctx.workspaceId;
    const normalizedName = payload.name.trim();
    const pathSegment = normalizePathSegment(normalizedName);
    if (!pathSegment) {
      throw new ValidationError(
        "Directory name must include at least one alphanumeric character",
      );
    }

    const parentId = normalizeParentId(payload.parentId);
    await assertParentIsAllowed({
      parentId,
      workspaceId,
      deps,
    });

    const createDirectoryWithValidation = async () => {
      const existingDirectory =
        await deps.findContentDirectoryByWorkspaceParentAndPathSegment({
          workspaceId,
          parentId,
          pathSegment,
        });
      if (existingDirectory) {
        throw new ValidationError("A directory with this name already exists");
      }

      try {
        const created = await deps.createContentDirectory({
          workspaceId,
          parentId,
          name: normalizedName,
          pathSegment,
          createdBy: ctx.userId ?? null,
        });
        return {
          id: created.id,
          parentId: created.parentId,
          name: created.name,
          pathSegment: created.pathSegment,
        };
      } catch (error) {
        if (isUniqueViolationError(error)) {
          throw new ValidationError(
            "A directory with this name already exists",
          );
        }
        throw error;
      }
    };

    if (!parentId) {
      return await runWithinRootPathMutex({
        workspaceId,
        pathSegment,
        run: createDirectoryWithValidation,
      });
    }

    return await createDirectoryWithValidation();
  };
}

export function createHandleContentDirectoriesUpdate(
  deps: ContentDirectoriesUpdateDeps,
) {
  return async function handleContentDirectoriesUpdate(
    payload: ContentDirectoriesUpdatePayload,
    ctx: ActionContext,
  ): Promise<ContentDirectoryDTO> {
    // CMS-API-KEY-ACTOR-1 (Story C): directory writes are out-of-preset.
    requireUserActor(ctx);
    const workspaceId = ctx.workspaceId;
    const directoryId = payload.directoryId.trim();
    const normalizedName = payload.name.trim();
    const pathSegment = normalizePathSegment(normalizedName);
    if (!pathSegment) {
      throw new ValidationError(
        "Directory name must include at least one alphanumeric character",
      );
    }

    const existingDirectory = await deps.findContentDirectoryByIdAndWorkspace(
      directoryId,
      workspaceId,
    );
    if (!existingDirectory) {
      throw new ValidationError("Directory was not found");
    }

    const siblingCollision =
      await deps.findContentDirectoryByWorkspaceParentAndPathSegment({
        workspaceId,
        parentId: existingDirectory.parentId,
        pathSegment,
      });
    if (siblingCollision && siblingCollision.id !== existingDirectory.id) {
      throw new ValidationError("A directory with this name already exists");
    }

    try {
      const updated = await deps.updateContentDirectoryByIdAndWorkspace({
        id: existingDirectory.id,
        workspaceId,
        name: normalizedName,
        pathSegment,
      });
      if (!updated) {
        throw new ValidationError("Directory was not found");
      }

      return {
        id: updated.id,
        parentId: updated.parentId,
        name: updated.name,
        pathSegment: updated.pathSegment,
      };
    } catch (error) {
      if (isUniqueViolationError(error)) {
        throw new ValidationError("A directory with this name already exists");
      }
      throw error;
    }
  };
}

export function createHandleContentDirectoriesDelete(
  deps: ContentDirectoriesDeleteDeps,
) {
  return async function handleContentDirectoriesDelete(
    payload: ContentDirectoriesDeletePayload,
    ctx: ActionContext,
  ): Promise<{ deletedCount: number }> {
    // CMS-API-KEY-ACTOR-1 (Story C): directory writes are out-of-preset.
    requireUserActor(ctx);
    const workspaceId = ctx.workspaceId;
    const directoryId = payload.directoryId.trim();

    const targetDirectory = await deps.findContentDirectoryByIdAndWorkspace(
      directoryId,
      workspaceId,
    );
    if (!targetDirectory) {
      throw new ValidationError("Directory was not found");
    }

    const deletedCount =
      await deps.deleteContentDirectorySubtreeByIdAndWorkspace({
        workspaceId,
        directoryId: targetDirectory.id,
      });
    return { deletedCount };
  };
}

export const handleContentDirectoriesListForWorkspace =
  createHandleContentDirectoriesListForWorkspace({
    listContentDirectoriesForWorkspace,
  });

export const handleContentDirectoriesCreate =
  createHandleContentDirectoriesCreate({
    createContentDirectory,
    findContentDirectoryByIdAndWorkspace,
    findContentDirectoryByWorkspaceParentAndPathSegment,
    withRootContentDirectoryPathMutex,
  });

export const handleContentDirectoriesUpdate =
  createHandleContentDirectoriesUpdate({
    findContentDirectoryByIdAndWorkspace,
    findContentDirectoryByWorkspaceParentAndPathSegment,
    updateContentDirectoryByIdAndWorkspace,
  });

export const handleContentDirectoriesDelete =
  createHandleContentDirectoriesDelete({
    findContentDirectoryByIdAndWorkspace,
    deleteContentDirectorySubtreeByIdAndWorkspace,
  });
