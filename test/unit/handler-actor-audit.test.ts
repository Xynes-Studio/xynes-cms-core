/**
 * CMS-API-KEY-ACTOR-1 (Story C) — Per-handler audit-actor decision.
 *
 * Exercises the contract documented in
 * `xynes/xynes-infra/docs/plans/2026-05-10-cms-core-api-key-actor-recognition.md`
 * §7 + §8 (cases #12–#19 in the Story D required-test enumeration):
 *
 *   In-preset handlers (`cms_authoring` + `cms_publisher`):
 *     #12 cms.entry.create  — api_key → row inserted with
 *                              `createdBy IS NULL`, `updatedBy IS NULL`.
 *     #13 cms.entry.update  — api_key → row updated with
 *                              `updatedBy IS NULL`, prior `createdBy`
 *                              preserved by the repository contract.
 *     #14 cms.entry.publish — api_key → publish succeeds with
 *                              `status='published'`, `updatedBy IS NULL`.
 *     (Plus: cms.entry.status.set with api_key → `updatedBy IS NULL`.)
 *
 *   Out-of-preset handlers (handler-side belt-and-braces — the gateway
 *   scope check already 403s these for every MVP preset):
 *     #15 cms.entry.delete                  → ForbiddenActorKindError
 *     #16 cms.entry.collaborators.set       → ForbiddenActorKindError
 *     #17 cms.entry.favorite.toggle         → ForbiddenActorKindError
 *     #17a cms.entry.favorite.list          → ForbiddenActorKindError
 *     #18 cms.entry.share.generateInternalLink → ForbiddenActorKindError
 *     #19 cms.content_directories.{list,create,update,delete} all
 *                                            → ForbiddenActorKindError
 *
 * The user-actor regression path (audit columns = the user's UUID) is
 * already covered by the existing `entry-management.handler.test.ts`
 * and `content-directories.handler.test.ts` suites. This file adds the
 * api_key-actor cases without retreading user-actor ground.
 */

import { beforeEach, describe, expect, it, vi } from "bun:test";

import { ForbiddenActorKindError } from "../../src/actions/errors";
import {
  createHandleContentDirectoriesCreate,
  createHandleContentDirectoriesDelete,
  createHandleContentDirectoriesListForWorkspace,
  createHandleContentDirectoriesUpdate,
} from "../../src/actions/handlers/content-directories.handler";
import {
  createHandleEntryCollaboratorsSet,
  createHandleEntryCreate,
  createHandleEntryDelete,
  createHandleEntryFavoriteList,
  createHandleEntryFavoriteToggle,
  createHandleEntryGetById,
  createHandleEntryListByDirectory,
  createHandleEntryPublish,
  createHandleEntryShareGenerateInternalLink,
  createHandleEntryStatusSet,
  createHandleEntryUpdate,
  EntryFavoriteListPayloadSchema,
  EntryListByDirectoryPayloadSchema,
} from "../../src/actions/handlers/entry-management.handler";
import type {
  ActionContext,
  ApiKeyActor,
  UserActor,
} from "../../src/actions/types";

// ──────────────────────────────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────────────────────────────

const WORKSPACE_ID = "f4f16484-3d37-491a-9799-fb44349d46df";
const HUMAN_USER_ID = "5e4c9542-72bc-4781-9f0f-8a21465de7de";
const ENTRY_ID = "9d53bd85-6e0d-40a0-8970-c15dcfbe1be1";
const CONTENT_TYPE_ID = "68220d1e-c34c-4623-a5fb-cf9f1605e66a";
const DIRECTORY_ID = "ce63b7f7-c8db-4f2d-9f57-2fd265c3ab01";
const API_KEY_ID = "11111111-1111-4111-8111-111111111111";
const API_KEY_PREFIX = "0a1b2c3d";

const apiKeyActor: ApiKeyActor = {
  kind: "api_key",
  apiKeyId: API_KEY_ID,
  keyPrefix: API_KEY_PREFIX,
};

const userActor: UserActor = {
  kind: "user",
  userId: HUMAN_USER_ID,
};

const apiKeyCtx: ActionContext = {
  workspaceId: WORKSPACE_ID,
  actor: apiKeyActor,
};

const userCtx: ActionContext = {
  workspaceId: WORKSPACE_ID,
  userId: HUMAN_USER_ID,
  actor: userActor,
};

function baseEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: ENTRY_ID,
    workspaceId: WORKSPACE_ID,
    contentTypeId: CONTENT_TYPE_ID,
    directoryId: DIRECTORY_ID,
    documentId: null,
    data: {
      title: "Initial title",
      description: "Initial description",
      tags: ["alpha"],
      popularityScore: 3,
    },
    status: "draft" as const,
    publishedAt: null,
    createdBy: HUMAN_USER_ID,
    updatedBy: HUMAN_USER_ID,
    deletedAt: null,
    deletedBy: null,
    createdAt: new Date("2026-02-25T12:00:00.000Z"),
    updatedAt: new Date("2026-02-25T12:00:00.000Z"),
    ...overrides,
  };
}

function buildEntryDeps() {
  return {
    createEntry: vi.fn(),
    findContentTypeByTemplateKey: vi.fn(),
    ensureContentTypeDefaults: vi.fn(),
    findContentDirectoryByIdAndWorkspace: vi.fn(),
    findEntryByIdAndWorkspace: vi.fn(),
    updateEntryByIdAndWorkspaceScoped: vi.fn(),
    softDeleteEntryByIdAndWorkspace: vi.fn(),
    publishEntryByIdAndWorkspace: vi.fn(),
    setEntryStatusByIdAndWorkspace: vi.fn(),
    listEntriesByDirectory: vi.fn(),
    listEntryCollaboratorsByEntryIds: vi.fn(),
    replaceEntryCollaborators: vi.fn(),
    toggleEntryFavorite: vi.fn(),
    listFavoriteEntryIdsByUser: vi.fn(),
    listFavoritedEntriesByUser: vi.fn(),
  };
}

// ──────────────────────────────────────────────────────────────────────
// In-preset entry handlers — accept api_key, audit columns = NULL.
// ──────────────────────────────────────────────────────────────────────

describe("entry-management — Story C in-preset api_key audit", () => {
  let deps: ReturnType<typeof buildEntryDeps>;

  beforeEach(() => {
    deps = buildEntryDeps();
    deps.findContentTypeByTemplateKey.mockResolvedValue({
      id: CONTENT_TYPE_ID,
    });
    deps.findContentDirectoryByIdAndWorkspace.mockResolvedValue({
      id: DIRECTORY_ID,
      workspaceId: WORKSPACE_ID,
    });
  });

  // #12 — cms.entry.create as api_key writes createdBy/updatedBy = NULL.
  it("entry.create with api_key actor writes createdBy/updatedBy as NULL", async () => {
    deps.createEntry.mockResolvedValue(
      baseEntry({ createdBy: null, updatedBy: null }),
    );
    const handler = createHandleEntryCreate(deps as never);

    await handler({ title: "Hello from API key" }, apiKeyCtx);

    expect(deps.createEntry).toHaveBeenCalledTimes(1);
    const args = deps.createEntry.mock.calls[0]?.[0];
    expect(args).toMatchObject({
      workspaceId: WORKSPACE_ID,
      createdBy: null,
      updatedBy: null,
    });
    expect(args).not.toHaveProperty("createdBy", HUMAN_USER_ID);
  });

  // Regression: cms.entry.create as user actor keeps non-null audit cols.
  it("entry.create with user actor still writes createdBy = userId (regression)", async () => {
    deps.createEntry.mockResolvedValue(baseEntry());
    const handler = createHandleEntryCreate(deps as never);

    await handler({ title: "Hello from human" }, userCtx);

    expect(deps.createEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        createdBy: HUMAN_USER_ID,
        updatedBy: HUMAN_USER_ID,
      }),
    );
  });

  // #13 — cms.entry.update as api_key writes updatedBy = NULL explicitly.
  it("entry.update with api_key actor sets updatedBy = null explicitly", async () => {
    deps.findEntryByIdAndWorkspace.mockResolvedValue(baseEntry());
    deps.updateEntryByIdAndWorkspaceScoped.mockResolvedValue(
      baseEntry({
        data: {
          title: "New title",
          description: "Initial description",
          tags: ["alpha"],
          popularityScore: 3,
        },
        updatedBy: null,
      }),
    );
    const handler = createHandleEntryUpdate(deps as never);

    await handler({ entryId: ENTRY_ID, title: "New title" }, apiKeyCtx);

    expect(deps.updateEntryByIdAndWorkspaceScoped).toHaveBeenCalledTimes(1);
    const args = deps.updateEntryByIdAndWorkspaceScoped.mock.calls[0]?.[0];
    // updatedBy is PRESENT and EXPLICITLY null — not omitted.
    expect(args).toHaveProperty("updatedBy", null);
  });

  // #14 — cms.entry.publish as api_key writes updatedBy = NULL.
  it("entry.publish with api_key actor sets updatedBy = null", async () => {
    deps.setEntryStatusByIdAndWorkspace.mockResolvedValue(
      baseEntry({
        status: "published",
        publishedAt: new Date("2026-05-12T12:00:00.000Z"),
        updatedBy: null,
      }),
    );
    const handler = createHandleEntryPublish(deps as never);

    const result = await handler({ entryId: ENTRY_ID }, apiKeyCtx);

    expect(deps.setEntryStatusByIdAndWorkspace).toHaveBeenCalledWith({
      entryId: ENTRY_ID,
      workspaceId: WORKSPACE_ID,
      status: "published",
      publishedAt: undefined,
      updatedBy: null,
    });
    expect(result.entry.status).toBe("published");
  });

  // #14a — cms.entry.status.set as api_key writes updatedBy = NULL.
  it("entry.status.set with api_key actor sets updatedBy = null", async () => {
    deps.setEntryStatusByIdAndWorkspace.mockResolvedValue(
      baseEntry({ status: "archived", updatedBy: null }),
    );
    const handler = createHandleEntryStatusSet(deps as never);

    await handler(
      { entryId: ENTRY_ID, status: "archived" as const },
      apiKeyCtx,
    );

    expect(deps.setEntryStatusByIdAndWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        entryId: ENTRY_ID,
        workspaceId: WORKSPACE_ID,
        status: "archived",
        updatedBy: null,
      }),
    );
  });

  // Read actions in preset still work for api_key (no audit columns).
  it("entry.getById with api_key actor returns the entry without listing user favorites", async () => {
    deps.findEntryByIdAndWorkspace.mockResolvedValue(baseEntry());
    deps.listEntryCollaboratorsByEntryIds.mockResolvedValue(
      new Map([[ENTRY_ID, []]]),
    );
    // Favorites must NOT be queried for an api_key actor (no userId).
    const handler = createHandleEntryGetById(deps as never);

    const result = await handler({ entryId: ENTRY_ID }, apiKeyCtx);

    expect(result.entry.id).toBe(ENTRY_ID);
    expect(deps.listFavoriteEntryIdsByUser).not.toHaveBeenCalled();
  });

  it("entry.listByDirectory with api_key actor lists entries without user favorites", async () => {
    deps.listEntriesByDirectory.mockResolvedValue([baseEntry()]);
    deps.listEntryCollaboratorsByEntryIds.mockResolvedValue(new Map());
    const handler = createHandleEntryListByDirectory(deps as never);

    const result = await handler(
      EntryListByDirectoryPayloadSchema.parse({}),
      apiKeyCtx,
    );

    expect(result.count).toBe(1);
    expect(deps.listFavoriteEntryIdsByUser).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────────────────────────
// Out-of-preset entry handlers — 403 FORBIDDEN_ACTOR_KIND on api_key.
// ──────────────────────────────────────────────────────────────────────

describe("entry-management — Story C out-of-preset api_key rejection", () => {
  let deps: ReturnType<typeof buildEntryDeps>;

  beforeEach(() => {
    deps = buildEntryDeps();
  });

  // #15 — cms.entry.delete refuses api_key actor at the handler boundary.
  it("entry.delete with api_key actor throws ForbiddenActorKindError", async () => {
    const handler = createHandleEntryDelete(deps as never);

    await expect(
      handler({ entryId: ENTRY_ID }, apiKeyCtx),
    ).rejects.toBeInstanceOf(ForbiddenActorKindError);

    expect(deps.softDeleteEntryByIdAndWorkspace).not.toHaveBeenCalled();
  });

  it("entry.delete with api_key actor carries FORBIDDEN_ACTOR_KIND code (403)", async () => {
    const handler = createHandleEntryDelete(deps as never);
    let caught: unknown;
    try {
      await handler({ entryId: ENTRY_ID }, apiKeyCtx);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ForbiddenActorKindError);
    expect((caught as ForbiddenActorKindError).code).toBe(
      "FORBIDDEN_ACTOR_KIND",
    );
    expect((caught as ForbiddenActorKindError).statusCode).toBe(403);
  });

  // #16 — cms.entry.collaborators.set refuses api_key actor.
  it("entry.collaborators.set with api_key actor throws ForbiddenActorKindError", async () => {
    const handler = createHandleEntryCollaboratorsSet(deps as never);

    await expect(
      handler({ entryId: ENTRY_ID, collaborators: [] }, apiKeyCtx),
    ).rejects.toBeInstanceOf(ForbiddenActorKindError);

    // Guard must fire BEFORE any DB call (no entry lookup, no replace).
    expect(deps.findEntryByIdAndWorkspace).not.toHaveBeenCalled();
    expect(deps.replaceEntryCollaborators).not.toHaveBeenCalled();
  });

  // #17 — cms.entry.favorite.toggle refuses api_key actor.
  it("entry.favorite.toggle with api_key actor throws ForbiddenActorKindError", async () => {
    const handler = createHandleEntryFavoriteToggle(deps as never);

    await expect(
      handler({ entryId: ENTRY_ID }, apiKeyCtx),
    ).rejects.toBeInstanceOf(ForbiddenActorKindError);

    expect(deps.toggleEntryFavorite).not.toHaveBeenCalled();
  });

  // #17a — cms.entry.favorite.list refuses api_key actor.
  it("entry.favorite.list with api_key actor throws ForbiddenActorKindError", async () => {
    const handler = createHandleEntryFavoriteList(deps as never);

    await expect(
      handler(EntryFavoriteListPayloadSchema.parse({}), apiKeyCtx),
    ).rejects.toBeInstanceOf(ForbiddenActorKindError);

    expect(deps.listFavoritedEntriesByUser).not.toHaveBeenCalled();
  });

  // #18 — cms.entry.share.generateInternalLink refuses api_key actor.
  it("entry.share.generateInternalLink with api_key actor throws ForbiddenActorKindError", async () => {
    const handler = createHandleEntryShareGenerateInternalLink(deps as never);

    await expect(
      handler({ entryId: ENTRY_ID, workspaceSlug: "ws" }, apiKeyCtx),
    ).rejects.toBeInstanceOf(ForbiddenActorKindError);

    expect(deps.findEntryByIdAndWorkspace).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────────────────────────
// Out-of-preset directory handlers — all reject api_key.
// ──────────────────────────────────────────────────────────────────────

describe("content-directories — Story C out-of-preset api_key rejection", () => {
  // #19 — every cms.content_directories.* handler rejects api_key.
  it("content_directories.listForWorkspace with api_key actor throws ForbiddenActorKindError", async () => {
    const listForWorkspace = vi.fn();
    const handler = createHandleContentDirectoriesListForWorkspace({
      listContentDirectoriesForWorkspace: listForWorkspace,
    } as never);

    await expect(handler(undefined as never, apiKeyCtx)).rejects.toBeInstanceOf(
      ForbiddenActorKindError,
    );
    expect(listForWorkspace).not.toHaveBeenCalled();
  });

  it("content_directories.create with api_key actor throws ForbiddenActorKindError", async () => {
    const create = vi.fn();
    const handler = createHandleContentDirectoriesCreate({
      createContentDirectory: create,
      findContentDirectoryByIdAndWorkspace: vi.fn(),
      findContentDirectoryByWorkspaceParentAndPathSegment: vi.fn(),
    } as never);

    await expect(
      handler({ name: "marketing", parentId: null } as never, apiKeyCtx),
    ).rejects.toBeInstanceOf(ForbiddenActorKindError);
    expect(create).not.toHaveBeenCalled();
  });

  it("content_directories.update with api_key actor throws ForbiddenActorKindError", async () => {
    const update = vi.fn();
    const handler = createHandleContentDirectoriesUpdate({
      findContentDirectoryByIdAndWorkspace: vi.fn(),
      findContentDirectoryByWorkspaceParentAndPathSegment: vi.fn(),
      updateContentDirectoryByIdAndWorkspace: update,
    } as never);

    await expect(
      handler(
        { directoryId: DIRECTORY_ID, name: "renamed" } as never,
        apiKeyCtx,
      ),
    ).rejects.toBeInstanceOf(ForbiddenActorKindError);
    expect(update).not.toHaveBeenCalled();
  });

  it("content_directories.delete with api_key actor throws ForbiddenActorKindError", async () => {
    const remove = vi.fn();
    const handler = createHandleContentDirectoriesDelete({
      findContentDirectoryByIdAndWorkspace: vi.fn(),
      deleteContentDirectorySubtreeByIdAndWorkspace: remove,
    } as never);

    await expect(
      handler({ directoryId: DIRECTORY_ID } as never, apiKeyCtx),
    ).rejects.toBeInstanceOf(ForbiddenActorKindError);
    expect(remove).not.toHaveBeenCalled();
  });
});
