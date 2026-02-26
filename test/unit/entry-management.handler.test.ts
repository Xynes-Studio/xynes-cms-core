import { beforeEach, describe, expect, it, vi } from "bun:test";
import {
  EntryCollaboratorsSetPayloadSchema,
  EntryCreatePayloadSchema,
  EntryFavoriteListPayloadSchema,
  EntryFavoriteTogglePayloadSchema,
  EntryListByDirectoryPayloadSchema,
  EntryShareGenerateInternalLinkPayloadSchema,
  createHandleEntryCollaboratorsSet,
  createHandleEntryCreate,
  createHandleEntryDelete,
  createHandleEntryFavoriteList,
  createHandleEntryFavoriteToggle,
  createHandleEntryGetById,
  createHandleEntryListByDirectory,
  createHandleEntryPublish,
  createHandleEntryShareGenerateInternalLink,
  createHandleEntryUpdate,
} from "../../src/actions/handlers/entry-management.handler";
import { EntryNotFoundError, ValidationError } from "../../src/actions/errors";
import type { ActionContext } from "../../src/actions/types";

const fixedNow = new Date("2026-02-26T12:00:00.000Z");

function baseEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: "9d53bd85-6e0d-40a0-8970-c15dcfbe1be1",
    workspaceId: "f4f16484-3d37-491a-9799-fb44349d46df",
    contentTypeId: "68220d1e-c34c-4623-a5fb-cf9f1605e66a",
    directoryId: "ce63b7f7-c8db-4f2d-9f57-2fd265c3ab01",
    documentId: null,
    data: {
      title: "Initial title",
      description: "Initial description",
      tags: ["alpha"],
      popularityScore: 3,
    },
    status: "draft",
    publishedAt: null,
    deletedAt: null,
    deletedBy: null,
    createdAt: new Date("2026-02-25T12:00:00.000Z"),
    updatedAt: new Date("2026-02-25T12:00:00.000Z"),
    ...overrides,
  };
}

const ctx: ActionContext = {
  workspaceId: "f4f16484-3d37-491a-9799-fb44349d46df",
  userId: "5e4c9542-72bc-4781-9f0f-8a21465de7de",
};

describe("entry-management schemas", () => {
  it("rejects extra keys in create payload", () => {
    const result = EntryCreatePayloadSchema.safeParse({
      contentTypeId: "68220d1e-c34c-4623-a5fb-cf9f1605e66a",
      title: "My entry",
      unexpected: true,
    });
    expect(result.success).toBe(false);
  });

  it("validates list payload defaults", () => {
    const result = EntryListByDirectoryPayloadSchema.parse({});
    expect(result.sortBy).toBe("date");
    expect(result.limit).toBe(20);
    expect(result.offset).toBe(0);
  });

  it("validates favorite list payload defaults", () => {
    const result = EntryFavoriteListPayloadSchema.parse({});
    expect(result.limit).toBe(20);
    expect(result.offset).toBe(0);
  });

  it("rejects duplicate collaborator user IDs", () => {
    const result = EntryCollaboratorsSetPayloadSchema.safeParse({
      entryId: "9d53bd85-6e0d-40a0-8970-c15dcfbe1be1",
      collaborators: [
        { userId: "5e4c9542-72bc-4781-9f0f-8a21465de7de" },
        { userId: "5e4c9542-72bc-4781-9f0f-8a21465de7de" },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("requires workspaceSlug for share link payload", () => {
    const result = EntryShareGenerateInternalLinkPayloadSchema.safeParse({
      entryId: "9d53bd85-6e0d-40a0-8970-c15dcfbe1be1",
      workspaceSlug: "",
    });
    expect(result.success).toBe(false);
  });
});

describe("entry-management handlers", () => {
  const deps = {
    createEntry: vi.fn(),
    findContentTypeByIdAndWorkspace: vi.fn(),
    findContentDirectoryByIdAndWorkspace: vi.fn(),
    findEntryByIdAndWorkspace: vi.fn(),
    updateEntryByIdAndWorkspaceScoped: vi.fn(),
    softDeleteEntryByIdAndWorkspace: vi.fn(),
    publishEntryByIdAndWorkspace: vi.fn(),
    listEntriesByDirectory: vi.fn(),
    listEntryCollaboratorsByEntryIds: vi.fn(),
    replaceEntryCollaborators: vi.fn(),
    toggleEntryFavorite: vi.fn(),
    listFavoriteEntryIdsByUser: vi.fn(),
    listFavoritedEntriesByUser: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    deps.findContentTypeByIdAndWorkspace.mockResolvedValue({
      id: "68220d1e-c34c-4623-a5fb-cf9f1605e66a",
    });
    deps.findContentDirectoryByIdAndWorkspace.mockResolvedValue({
      id: "ce63b7f7-c8db-4f2d-9f57-2fd265c3ab01",
      workspaceId: ctx.workspaceId,
    });
  });

  it("creates and publishes entry when publishNow=true", async () => {
    const handler = createHandleEntryCreate(deps as any);
    deps.createEntry.mockResolvedValue(
      baseEntry({
        status: "published",
        publishedAt: fixedNow,
      }),
    );

    const result = await handler(
      {
        contentTypeId: "68220d1e-c34c-4623-a5fb-cf9f1605e66a",
        directoryId: "ce63b7f7-c8db-4f2d-9f57-2fd265c3ab01",
        title: "Entry title",
        description: "Entry description",
        tags: ["alpha", "beta"],
        publishNow: true,
      },
      ctx,
    );

    expect(deps.createEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: ctx.workspaceId,
        status: "published",
      }),
    );
    expect(result.entry.status).toBe("published");
  });

  it("updates entry metadata with safe merge", async () => {
    const handler = createHandleEntryUpdate(deps as any);
    deps.findEntryByIdAndWorkspace.mockResolvedValue(baseEntry());
    deps.updateEntryByIdAndWorkspaceScoped.mockResolvedValue(
      baseEntry({
        data: {
          title: "Updated title",
          description: "Initial description",
          tags: ["gamma"],
          popularityScore: 3,
        },
      }),
    );

    const result = await handler(
      {
        entryId: "9d53bd85-6e0d-40a0-8970-c15dcfbe1be1",
        title: "Updated title",
        tags: ["gamma"],
      },
      ctx,
    );

    expect(result.entry.title).toBe("Updated title");
    expect(result.entry.tags).toEqual(["gamma"]);
  });

  it("soft deletes entry with actor userId", async () => {
    const handler = createHandleEntryDelete(deps as any);
    deps.softDeleteEntryByIdAndWorkspace.mockResolvedValue(
      baseEntry({
        deletedAt: fixedNow,
        deletedBy: ctx.userId,
      }),
    );

    const result = await handler(
      { entryId: "9d53bd85-6e0d-40a0-8970-c15dcfbe1be1" },
      ctx,
    );
    expect(result.success).toBe(true);
    expect(result.deletedBy).toBe(ctx.userId);
  });

  it("publishes existing draft entry", async () => {
    const handler = createHandleEntryPublish(deps as any);
    deps.publishEntryByIdAndWorkspace.mockResolvedValue(
      baseEntry({
        status: "published",
        publishedAt: fixedNow,
      }),
    );

    const result = await handler(
      { entryId: "9d53bd85-6e0d-40a0-8970-c15dcfbe1be1" },
      ctx,
    );
    expect(result.entry.status).toBe("published");
    expect(result.entry.publishedAt).toBeTruthy();
  });

  it("returns list items with collaborators and favorite flag", async () => {
    const handler = createHandleEntryListByDirectory(deps as any);
    deps.listEntriesByDirectory.mockResolvedValue([baseEntry()]);
    deps.listEntryCollaboratorsByEntryIds.mockResolvedValue(
      new Map([
        [
          "9d53bd85-6e0d-40a0-8970-c15dcfbe1be1",
          [{ userId: "u-1", displayName: "Teammate" }],
        ],
      ]),
    );
    deps.listFavoriteEntryIdsByUser.mockResolvedValue(
      new Set(["9d53bd85-6e0d-40a0-8970-c15dcfbe1be1"]),
    );

    const result = await handler({}, ctx);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.collaborators).toEqual(["Teammate"]);
    expect(result.items[0]?.isFavorite).toBe(true);
  });

  it("gets entry by id and includes collaborator metadata", async () => {
    const handler = createHandleEntryGetById(deps as any);
    deps.findEntryByIdAndWorkspace.mockResolvedValue(baseEntry());
    deps.listEntryCollaboratorsByEntryIds.mockResolvedValue(
      new Map([["9d53bd85-6e0d-40a0-8970-c15dcfbe1be1", []]]),
    );
    deps.listFavoriteEntryIdsByUser.mockResolvedValue(new Set<string>());

    const result = await handler(
      { entryId: "9d53bd85-6e0d-40a0-8970-c15dcfbe1be1" },
      ctx,
    );
    expect(result.entry.id).toBe("9d53bd85-6e0d-40a0-8970-c15dcfbe1be1");
  });

  it("sets collaborators for an existing entry", async () => {
    const handler = createHandleEntryCollaboratorsSet(deps as any);
    deps.findEntryByIdAndWorkspace.mockResolvedValue(baseEntry());
    deps.replaceEntryCollaborators.mockResolvedValue([
      { userId: "u-1", displayName: "One" },
      { userId: "u-2", displayName: "Two" },
    ]);

    const result = await handler(
      {
        entryId: "9d53bd85-6e0d-40a0-8970-c15dcfbe1be1",
        collaborators: [
          { userId: "u-1", displayName: "One" },
          { userId: "u-2", displayName: "Two" },
        ],
      },
      ctx,
    );
    expect(result.collaborators).toEqual(["One", "Two"]);
  });

  it("toggles favorite for actor user", async () => {
    const handler = createHandleEntryFavoriteToggle(deps as any);
    deps.findEntryByIdAndWorkspace.mockResolvedValue(baseEntry());
    deps.toggleEntryFavorite.mockResolvedValue({ isFavorite: true });

    const result = await handler(
      { entryId: "9d53bd85-6e0d-40a0-8970-c15dcfbe1be1" },
      ctx,
    );
    expect(result.isFavorite).toBe(true);
  });

  it("lists favorited entries", async () => {
    const handler = createHandleEntryFavoriteList(deps as any);
    deps.listFavoritedEntriesByUser.mockResolvedValue([
      baseEntry({
        id: "2be59d46-f26a-4dbe-b42d-2f1e1f661a87",
      }),
    ]);
    deps.listEntryCollaboratorsByEntryIds.mockResolvedValue(
      new Map([["2be59d46-f26a-4dbe-b42d-2f1e1f661a87", []]]),
    );

    const result = await handler({}, ctx);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.isFavorite).toBe(true);
  });

  it("generates internal share link for existing entry", async () => {
    const handler = createHandleEntryShareGenerateInternalLink(deps as any);
    deps.findEntryByIdAndWorkspace.mockResolvedValue(baseEntry());

    const result = await handler(
      {
        entryId: "9d53bd85-6e0d-40a0-8970-c15dcfbe1be1",
        workspaceSlug: "my-workspace",
      },
      ctx,
    );
    expect(result.url).toBe(
      "/dashboard/my-workspace/content/entry/9d53bd85-6e0d-40a0-8970-c15dcfbe1be1/edit",
    );
  });

  it("throws ENTRY_NOT_FOUND when entry is absent", async () => {
    const handler = createHandleEntryGetById(deps as any);
    deps.findEntryByIdAndWorkspace.mockResolvedValue(null);

    await expect(
      handler({ entryId: "9d53bd85-6e0d-40a0-8970-c15dcfbe1be1" }, ctx),
    ).rejects.toBeInstanceOf(EntryNotFoundError);
  });

  it("throws validation error when userId missing for delete", async () => {
    const handler = createHandleEntryDelete(deps as any);
    deps.softDeleteEntryByIdAndWorkspace.mockResolvedValue(null);

    await expect(
      handler(
        { entryId: "9d53bd85-6e0d-40a0-8970-c15dcfbe1be1" },
        { workspaceId: ctx.workspaceId },
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects invalid favorite toggle schema payload", () => {
    const parsed = EntryFavoriteTogglePayloadSchema.safeParse({ entryId: "bad" });
    expect(parsed.success).toBe(false);
  });
});
