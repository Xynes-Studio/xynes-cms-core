import { beforeEach, describe, expect, it, vi } from "bun:test";
import {
  ContentTypeNotFoundError,
  EntryNotFoundError,
  UnauthorizedError,
  ValidationError,
} from "../../src/actions/errors";
import {
  EntryCollaboratorsSetPayloadSchema,
  EntryCreatePayloadSchema,
  EntryFavoriteListPayloadSchema,
  EntryFavoriteTogglePayloadSchema,
  EntryListByDirectoryPayloadSchema,
  EntryShareGenerateInternalLinkPayloadSchema,
  EntryStatusSetPayloadSchema,
  EntryUpdatePayloadSchema,
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
} from "../../src/actions/handlers/entry-management.handler";
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
    createdBy: "5e4c9542-72bc-4781-9f0f-8a21465de7de",
    updatedBy: "5e4c9542-72bc-4781-9f0f-8a21465de7de",
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
      title: "My entry",
      unexpected: true,
    });
    expect(result.success).toBe(false);
  });

  it("rejects legacy contentTypeId in create payload", () => {
    const result = EntryCreatePayloadSchema.safeParse({
      title: "My entry",
      contentTypeId: "68220d1e-c34c-4623-a5fb-cf9f1605e66a",
    });
    expect(result.success).toBe(false);
  });

  it("accepts structured editor body in create payload", () => {
    const result = EntryCreatePayloadSchema.safeParse({
      title: "My entry",
      body: {
        root: {
          type: "root",
          version: 1,
          children: [
            {
              type: "paragraph",
              version: 1,
              children: [],
            },
          ],
        },
      },
    });

    expect(result.success).toBe(true);
  });

  it("accepts structured editor body in update payload", () => {
    const result = EntryUpdatePayloadSchema.safeParse({
      entryId: "9d53bd85-6e0d-40a0-8970-c15dcfbe1be1",
      body: {
        root: {
          type: "root",
          version: 1,
          children: [
            {
              type: "paragraph",
              version: 1,
              children: [{ type: "text", version: 1, text: "Hello" }],
            },
          ],
        },
      },
    });

    expect(result.success).toBe(true);
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

  it("accepts scheduled status payload with future publishAt", () => {
    const result = EntryStatusSetPayloadSchema.safeParse({
      entryId: "9d53bd85-6e0d-40a0-8970-c15dcfbe1be1",
      status: "scheduled",
      publishAt: "2099-02-27T12:00:00.000Z",
    });

    expect(result.success).toBe(true);
  });

  it("rejects scheduled status payload without publishAt", () => {
    const result = EntryStatusSetPayloadSchema.safeParse({
      entryId: "9d53bd85-6e0d-40a0-8970-c15dcfbe1be1",
      status: "scheduled",
    });

    expect(result.success).toBe(false);
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
    listEntryCreatorsByUserIds: vi.fn(),
    replaceEntryCollaborators: vi.fn(),
    toggleEntryFavorite: vi.fn(),
    listFavoriteEntryIdsByUser: vi.fn(),
    listFavoritedEntriesByUser: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    deps.ensureContentTypeDefaults.mockResolvedValue({
      templates: { created: 0, skipped: 0 },
      contentTypes: { created: 0, skipped: 0 },
      processedTemplateKeys: ["blog_post"],
    });
    deps.findContentTypeByTemplateKey.mockResolvedValue({
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
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
        data: expect.objectContaining({
          slug: "entry-title",
        }),
      }),
    );
    expect(result.entry.status).toBe("published");
  });

  it("creates entry using default workspace content type", async () => {
    const handler = createHandleEntryCreate(deps as any);
    deps.createEntry.mockResolvedValue(baseEntry());

    await handler(
      {
        title: "Entry title",
      },
      ctx,
    );

    expect(deps.findContentTypeByTemplateKey).toHaveBeenCalledWith(
      "blog_post",
      ctx.workspaceId,
    );
    expect(deps.createEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        contentTypeId: "68220d1e-c34c-4623-a5fb-cf9f1605e66a",
      }),
    );
  });

  it("ensures defaults when workspace content type is missing", async () => {
    const handler = createHandleEntryCreate(deps as any);
    deps.findContentTypeByTemplateKey
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "68220d1e-c34c-4623-a5fb-cf9f1605e66a" });
    deps.createEntry.mockResolvedValue(baseEntry());

    await handler(
      {
        title: "Entry title",
      },
      ctx,
    );

    expect(deps.ensureContentTypeDefaults).toHaveBeenCalledWith(
      { templateKeys: ["blog_post"] },
      ctx,
    );
  });

  it("throws when default content type still does not exist after ensure defaults", async () => {
    const handler = createHandleEntryCreate(deps as any);
    deps.findContentTypeByTemplateKey
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    await expect(
      handler(
        {
          title: "Entry title",
        },
        ctx,
      ),
    ).rejects.toBeInstanceOf(ContentTypeNotFoundError);
  });

  it("falls back to a safe slug when title has no alphanumeric chars", async () => {
    const handler = createHandleEntryCreate(deps as any);
    deps.createEntry.mockResolvedValue(baseEntry());

    await handler(
      {
        title: "!!!",
      },
      ctx,
    );

    expect(deps.createEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          slug: "entry",
        }),
      }),
    );
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
    expect(deps.updateEntryByIdAndWorkspaceScoped).toHaveBeenCalledWith(
      expect.objectContaining({
        updatedBy: ctx.userId,
      }),
    );
  });

  it("updates entry body without crashing on structured editor JSON", async () => {
    const handler = createHandleEntryUpdate(deps as any);
    const body = {
      root: {
        type: "root",
        version: 1,
        children: [
          {
            type: "paragraph",
            version: 1,
            children: [{ type: "text", version: 1, text: "Draft body" }],
          },
        ],
      },
    };

    deps.findEntryByIdAndWorkspace.mockResolvedValue(
      baseEntry({
        data: {
          title: "Initial title",
          description: "Initial description",
          body: {
            root: {
              type: "root",
              version: 1,
              children: [],
            },
          },
          tags: ["alpha"],
          popularityScore: 3,
        },
      }),
    );
    deps.updateEntryByIdAndWorkspaceScoped.mockResolvedValue(
      baseEntry({
        data: {
          title: "Initial title",
          description: "Initial description",
          body,
          tags: ["alpha"],
          popularityScore: 3,
        },
      }),
    );

    const result = await handler(
      {
        entryId: "9d53bd85-6e0d-40a0-8970-c15dcfbe1be1",
        body,
      },
      ctx,
    );

    expect(deps.updateEntryByIdAndWorkspaceScoped).toHaveBeenCalledWith(
      expect.objectContaining({
        entryId: "9d53bd85-6e0d-40a0-8970-c15dcfbe1be1",
        workspaceId: ctx.workspaceId,
        data: expect.objectContaining({
          body,
        }),
      }),
    );
    expect(result.entry.body).toEqual(body);
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
    expect(result.deletedBy).toBe(ctx.userId ?? null);
  });

  it("publishes existing draft entry", async () => {
    const handler = createHandleEntryPublish(deps as any);
    deps.setEntryStatusByIdAndWorkspace.mockResolvedValue(
      baseEntry({
        status: "published",
        publishedAt: fixedNow,
      }),
    );

    const result = await handler(
      { entryId: "9d53bd85-6e0d-40a0-8970-c15dcfbe1be1" },
      ctx,
    );
    expect(deps.setEntryStatusByIdAndWorkspace).toHaveBeenCalledWith({
      entryId: "9d53bd85-6e0d-40a0-8970-c15dcfbe1be1",
      workspaceId: ctx.workspaceId,
      status: "published",
      publishedAt: undefined,
      updatedBy: ctx.userId,
    });
    expect(result.entry.status).toBe("published");
    expect(result.entry.publishedAt).toBeTruthy();
  });

  it("sets scheduled status for an existing entry with a future publishAt", async () => {
    const handler = createHandleEntryStatusSet(deps as any);
    deps.findEntryByIdAndWorkspace.mockResolvedValue(baseEntry());
    deps.setEntryStatusByIdAndWorkspace.mockResolvedValue(
      baseEntry({
        status: "scheduled",
        publishedAt: new Date("2099-02-27T12:00:00.000Z"),
      }),
    );

    const result = await handler(
      {
        entryId: "9d53bd85-6e0d-40a0-8970-c15dcfbe1be1",
        status: "scheduled",
        publishAt: "2099-02-27T12:00:00.000Z",
      },
      ctx,
    );

    expect(deps.setEntryStatusByIdAndWorkspace).toHaveBeenCalledWith({
      entryId: "9d53bd85-6e0d-40a0-8970-c15dcfbe1be1",
      workspaceId: ctx.workspaceId,
      status: "scheduled",
      publishedAt: new Date("2099-02-27T12:00:00.000Z"),
      updatedBy: ctx.userId,
    });
    expect(result.entry.status).toBe("scheduled");
  });

  it("rejects scheduling an already published entry", async () => {
    const handler = createHandleEntryStatusSet(deps as any);
    deps.findEntryByIdAndWorkspace.mockResolvedValue(
      baseEntry({
        status: "published",
        publishedAt: fixedNow,
      }),
    );

    await expect(
      handler(
        {
          entryId: "9d53bd85-6e0d-40a0-8970-c15dcfbe1be1",
          status: "scheduled",
          publishAt: "2099-02-27T12:00:00.000Z",
        },
        ctx,
      ),
    ).rejects.toBeInstanceOf(ValidationError);

    expect(deps.setEntryStatusByIdAndWorkspace).not.toHaveBeenCalled();
  });

  it("routes publish through the shared status transition helper", async () => {
    const handler = createHandleEntryPublish(deps as any);
    deps.setEntryStatusByIdAndWorkspace.mockResolvedValue(
      baseEntry({
        status: "published",
        publishedAt: fixedNow,
      }),
    );

    const result = await handler(
      { entryId: "9d53bd85-6e0d-40a0-8970-c15dcfbe1be1" },
      ctx,
    );

    expect(deps.setEntryStatusByIdAndWorkspace).toHaveBeenCalledWith({
      entryId: "9d53bd85-6e0d-40a0-8970-c15dcfbe1be1",
      workspaceId: ctx.workspaceId,
      status: "published",
      publishedAt: undefined,
      updatedBy: ctx.userId,
    });
    expect(deps.publishEntryByIdAndWorkspace).not.toHaveBeenCalled();
    expect(result.entry.status).toBe("published");
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
    deps.listEntryCreatorsByUserIds.mockResolvedValue(new Map());
    deps.listFavoriteEntryIdsByUser.mockResolvedValue(
      new Set(["9d53bd85-6e0d-40a0-8970-c15dcfbe1be1"]),
    );

    const result = await handler({}, ctx);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.collaborators).toEqual(["Teammate"]);
    expect(result.items[0]?.isFavorite).toBe(true);
  });

  it("passes scheduled status filter through listByDirectory", async () => {
    const handler = createHandleEntryListByDirectory(deps as any);
    deps.listEntriesByDirectory.mockResolvedValue([
      baseEntry({
        status: "scheduled",
        publishedAt: new Date("2099-02-27T12:00:00.000Z"),
      }),
    ]);
    deps.listEntryCollaboratorsByEntryIds.mockResolvedValue(new Map());
    deps.listEntryCreatorsByUserIds.mockResolvedValue(new Map());
    deps.listFavoriteEntryIdsByUser.mockResolvedValue(new Set<string>());

    const result = await handler({ status: "scheduled" as any }, ctx);

    expect(deps.listEntriesByDirectory).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: ctx.workspaceId,
        status: "scheduled",
      }),
    );
    expect(result.items[0]?.status).toBe("scheduled");
  });

  it("gets entry by id and includes collaborator metadata", async () => {
    const handler = createHandleEntryGetById(deps as any);
    deps.findEntryByIdAndWorkspace.mockResolvedValue(baseEntry());
    deps.listEntryCollaboratorsByEntryIds.mockResolvedValue(
      new Map([["9d53bd85-6e0d-40a0-8970-c15dcfbe1be1", []]]),
    );
    deps.listEntryCreatorsByUserIds.mockResolvedValue(new Map());
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
    deps.listEntryCreatorsByUserIds.mockResolvedValue(new Map());

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

  it("throws UnauthorizedError when no userId or actor is present for delete", async () => {
    const handler = createHandleEntryDelete(deps as any);
    deps.softDeleteEntryByIdAndWorkspace.mockResolvedValue(null);

    await expect(
      handler(
        { entryId: "9d53bd85-6e0d-40a0-8970-c15dcfbe1be1" },
        { workspaceId: ctx.workspaceId },
      ),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("rejects invalid favorite toggle schema payload", () => {
    const parsed = EntryFavoriteTogglePayloadSchema.safeParse({
      entryId: "bad",
    });
    expect(parsed.success).toBe(false);
  });
});
