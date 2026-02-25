import { z } from "zod";
import {
  createContentDirectory,
  findContentDirectoryByIdAndWorkspace,
  findContentDirectoryByWorkspaceParentAndPathSegment,
  listContentDirectoriesForWorkspace,
} from "../../infra/db/repositories/content-directory.repository";
import {
  findContentTypeByIdAndWorkspace,
  findContentTypeByRouteSegmentAndWorkspace,
} from "../../infra/db/repositories/content-type.repository";
import { ValidationError } from "../errors";
import type { ActionContext } from "../types";

const contentTypeParentPrefix = "content-type-";
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
  findContentTypeByIdAndWorkspace: typeof findContentTypeByIdAndWorkspace;
  findContentTypeByRouteSegmentAndWorkspace: typeof findContentTypeByRouteSegmentAndWorkspace;
}

export function createHandleContentDirectoriesListForWorkspace(
  deps: ContentDirectoriesListForWorkspaceDeps,
) {
  return async function handleContentDirectoriesListForWorkspace(
    _payload: ContentDirectoriesListForWorkspacePayload,
    ctx: ActionContext,
  ): Promise<ContentDirectoryDTO[]> {
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

  if (parentId.startsWith(contentTypeParentPrefix)) {
    const contentTypeId = parentId.slice(contentTypeParentPrefix.length);
    if (!isUuidLike(contentTypeId)) {
      throw new ValidationError("Invalid content type parent identifier");
    }

    const contentType = await deps.findContentTypeByIdAndWorkspace(
      contentTypeId,
      workspaceId,
    );
    if (!contentType) {
      throw new ValidationError("Parent content type was not found");
    }
    return;
  }

  throw new ValidationError("Invalid parentId");
}

export function createHandleContentDirectoriesCreate(
  deps: ContentDirectoriesCreateDeps,
) {
  return async function handleContentDirectoriesCreate(
    payload: ContentDirectoriesCreatePayload,
    ctx: ActionContext,
  ): Promise<ContentDirectoryDTO> {
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

    const existingDirectory =
      await deps.findContentDirectoryByWorkspaceParentAndPathSegment({
        workspaceId,
        parentId,
        pathSegment,
      });
    if (existingDirectory) {
      throw new ValidationError("A directory with this name already exists");
    }

    if (!parentId) {
      const collidingContentType =
        await deps.findContentTypeByRouteSegmentAndWorkspace(
          pathSegment,
          workspaceId,
        );
      if (collidingContentType) {
        throw new ValidationError(
          "Directory path conflicts with an existing content type route",
        );
      }
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
        throw new ValidationError("A directory with this name already exists");
      }
      throw error;
    }
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
    findContentTypeByIdAndWorkspace,
    findContentTypeByRouteSegmentAndWorkspace,
  });
