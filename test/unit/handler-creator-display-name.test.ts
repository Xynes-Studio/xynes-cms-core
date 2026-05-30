import { beforeEach, describe, expect, it, vi } from "bun:test";
import {
  EntryListByDirectoryPayloadSchema,
  createHandleEntryGetById,
  createHandleEntryListByDirectory,
} from "../../src/actions/handlers/entry-management.handler";
import type { ActionContext } from "../../src/actions/types";

// ──────────────────────────────────────────────────────────────────────
// BUG-CMS-8 — content list payload carries the real creator display name.
//
// Contract (mirrored from `mapEntry`):
//   - `created_by` UUID + `identity.users` row matched
//     => `creator: { id, displayName }` (display name may itself be null
//        because the identity column is nullable).
//   - `created_by` UUID + no row matched (deleted user / future cascade-
//     less path) => `creator: { id, displayName: null }`.
//   - `created_by` NULL (api_key actor — CMS-API-KEY-ACTOR-1 Story C)
//     => `creator: null`. The frontend renders "Created via API key" here
//        WITHOUT leaking the key id / prefix / hash.
//
// Tests do not hit the database. The repository contracts are mocked
// against the published `EntryManagementDeps` shape.
// ──────────────────────────────────────────────────────────────────────

const WORKSPACE_ID = "f4f16484-3d37-491a-9799-fb44349d46df";
const ENTRY_ID_A = "9d53bd85-6e0d-40a0-8970-c15dcfbe1be1";
const ENTRY_ID_B = "2be59d46-f26a-4dbe-b42d-2f1e1f661a87";
const ENTRY_ID_C = "8e15c711-6c25-4f72-aa15-fcd76d5cb47e";
const HUMAN_USER_ID_ALPHA = "5e4c9542-72bc-4781-9f0f-8a21465de7de";
const HUMAN_USER_ID_BRAVO = "df59a01d-bb89-4d4f-9c66-3c9f7a932f00";
const DELETED_USER_ID = "ccca5d8c-8d2e-4d6a-b5b9-5c84cf66c5e6";

const userCtx: ActionContext = {
  workspaceId: WORKSPACE_ID,
  userId: HUMAN_USER_ID_ALPHA,
  actor: { kind: "user", userId: HUMAN_USER_ID_ALPHA },
};

function entryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ENTRY_ID_A,
    workspaceId: WORKSPACE_ID,
    contentTypeId: "68220d1e-c34c-4623-a5fb-cf9f1605e66a",
    directoryId: "ce63b7f7-c8db-4f2d-9f57-2fd265c3ab01",
    documentId: null,
    data: { title: "Title", description: "Description", tags: [] },
    status: "draft" as const,
    publishedAt: null,
    createdBy: HUMAN_USER_ID_ALPHA,
    updatedBy: HUMAN_USER_ID_ALPHA,
    deletedAt: null,
    deletedBy: null,
    createdAt: new Date("2026-02-25T12:00:00.000Z"),
    updatedAt: new Date("2026-02-25T12:00:00.000Z"),
    ...overrides,
  };
}

function buildDeps() {
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
    listEntryCreatorsByUserIds: vi.fn(),
    replaceEntryCollaborators: vi.fn(),
    toggleEntryFavorite: vi.fn(),
    listFavoriteEntryIdsByUser: vi.fn(),
    listFavoritedEntriesByUser: vi.fn(),
  };
}

describe("BUG-CMS-8 — handleEntryListByDirectory creator field", () => {
  let deps: ReturnType<typeof buildDeps>;

  beforeEach(() => {
    deps = buildDeps();
    // Defaults for every test — overridden per-case below.
    deps.listEntryCollaboratorsByEntryIds.mockResolvedValue(new Map());
    deps.listFavoriteEntryIdsByUser.mockResolvedValue(new Set<string>());
    deps.listEntryCreatorsByUserIds.mockResolvedValue(new Map());
  });

  it("attaches creator.displayName for a real user-created entry", async () => {
    deps.listEntriesByDirectory.mockResolvedValue([
      entryRow({ createdBy: HUMAN_USER_ID_ALPHA }),
    ]);
    deps.listEntryCreatorsByUserIds.mockResolvedValue(
      new Map([
        [HUMAN_USER_ID_ALPHA, { id: HUMAN_USER_ID_ALPHA, displayName: "Alpha User" }],
      ]),
    );

    const handler = createHandleEntryListByDirectory(deps as never);
    const result = await handler(
      EntryListByDirectoryPayloadSchema.parse({}),
      userCtx,
    );

    expect(result.items[0]?.creator).toEqual({
      id: HUMAN_USER_ID_ALPHA,
      displayName: "Alpha User",
    });
  });

  it("returns creator: null when created_by is NULL (api_key actor entry)", async () => {
    deps.listEntriesByDirectory.mockResolvedValue([
      entryRow({ createdBy: null, updatedBy: null }),
    ]);

    const handler = createHandleEntryListByDirectory(deps as never);
    const result = await handler(
      EntryListByDirectoryPayloadSchema.parse({}),
      userCtx,
    );

    expect(result.items[0]?.creator).toBeNull();
    // The lookup MUST NOT be issued at all when no entry has a UUID — saves
    // a round-trip when every entry was created by api_key actors.
    expect(deps.listEntryCreatorsByUserIds).not.toHaveBeenCalled();
  });

  it("returns { id, displayName: null } when created_by is a UUID with no matching identity row", async () => {
    deps.listEntriesByDirectory.mockResolvedValue([
      entryRow({ createdBy: DELETED_USER_ID }),
    ]);
    // Empty map — repo found no row for the UUID (orphan / deleted user).
    deps.listEntryCreatorsByUserIds.mockResolvedValue(new Map());

    const handler = createHandleEntryListByDirectory(deps as never);
    const result = await handler(
      EntryListByDirectoryPayloadSchema.parse({}),
      userCtx,
    );

    expect(result.items[0]?.creator).toEqual({
      id: DELETED_USER_ID,
      displayName: null,
    });
  });

  it("batches the creator lookup with a unique set of user UUIDs", async () => {
    deps.listEntriesByDirectory.mockResolvedValue([
      entryRow({ id: ENTRY_ID_A, createdBy: HUMAN_USER_ID_ALPHA }),
      entryRow({ id: ENTRY_ID_B, createdBy: HUMAN_USER_ID_BRAVO }),
      // Duplicate ALPHA — must collapse to ONE entry in the unique set.
      entryRow({ id: ENTRY_ID_C, createdBy: HUMAN_USER_ID_ALPHA }),
    ]);
    deps.listEntryCreatorsByUserIds.mockResolvedValue(
      new Map([
        [HUMAN_USER_ID_ALPHA, { id: HUMAN_USER_ID_ALPHA, displayName: "Alpha" }],
        [HUMAN_USER_ID_BRAVO, { id: HUMAN_USER_ID_BRAVO, displayName: "Bravo" }],
      ]),
    );

    const handler = createHandleEntryListByDirectory(deps as never);
    const result = await handler(
      EntryListByDirectoryPayloadSchema.parse({}),
      userCtx,
    );

    expect(deps.listEntryCreatorsByUserIds).toHaveBeenCalledTimes(1);
    const callArg = deps.listEntryCreatorsByUserIds.mock.calls[0]?.[0] as {
      userIds: string[];
    };
    expect(callArg.userIds.sort()).toEqual(
      [HUMAN_USER_ID_ALPHA, HUMAN_USER_ID_BRAVO].sort(),
    );

    expect(result.items).toHaveLength(3);
    expect(result.items[0]?.creator?.displayName).toBe("Alpha");
    expect(result.items[1]?.creator?.displayName).toBe("Bravo");
    expect(result.items[2]?.creator?.displayName).toBe("Alpha");
  });

  it("mixes api_key entries (creator: null) with user-actor entries (creator: { ... }) cleanly", async () => {
    deps.listEntriesByDirectory.mockResolvedValue([
      entryRow({ id: ENTRY_ID_A, createdBy: HUMAN_USER_ID_ALPHA }),
      entryRow({ id: ENTRY_ID_B, createdBy: null }),
    ]);
    deps.listEntryCreatorsByUserIds.mockResolvedValue(
      new Map([
        [HUMAN_USER_ID_ALPHA, { id: HUMAN_USER_ID_ALPHA, displayName: "Alpha" }],
      ]),
    );

    const handler = createHandleEntryListByDirectory(deps as never);
    const result = await handler(
      EntryListByDirectoryPayloadSchema.parse({}),
      userCtx,
    );

    expect(result.items[0]?.creator).toEqual({
      id: HUMAN_USER_ID_ALPHA,
      displayName: "Alpha",
    });
    expect(result.items[1]?.creator).toBeNull();
  });

  it("does not leak internal audit handles into the wire DTO for api_key actor entries", async () => {
    deps.listEntriesByDirectory.mockResolvedValue([
      entryRow({ createdBy: null, updatedBy: null }),
    ]);

    const handler = createHandleEntryListByDirectory(deps as never);
    const result = await handler(
      EntryListByDirectoryPayloadSchema.parse({}),
      userCtx,
    );

    const wire = JSON.stringify(result);
    // Must not embed key-shaped identifiers, hashes, or any audit handle
    // through the creator slot (the AGENTS.md security invariant).
    expect(wire).not.toMatch(/apiKeyId/);
    expect(wire).not.toMatch(/keyPrefix/);
    expect(wire).not.toMatch(/key_hash/);
    expect(wire).not.toMatch(/keyHash/);
    expect(wire).not.toMatch(/xynes_live_/);
  });

  it("preserves the legacy ownerName field independently of creator", async () => {
    // ownerName lives on the entry `data` JSON blob and reflects an
    // editor-provided alias rather than the creator's identity. The two
    // are independent dimensions and both should be surfaced on the DTO.
    deps.listEntriesByDirectory.mockResolvedValue([
      entryRow({
        createdBy: HUMAN_USER_ID_ALPHA,
        data: { title: "T", description: "D", tags: [], ownerName: "Custom Owner" },
      }),
    ]);
    deps.listEntryCreatorsByUserIds.mockResolvedValue(
      new Map([
        [HUMAN_USER_ID_ALPHA, { id: HUMAN_USER_ID_ALPHA, displayName: "Alpha" }],
      ]),
    );

    const handler = createHandleEntryListByDirectory(deps as never);
    const result = await handler(
      EntryListByDirectoryPayloadSchema.parse({}),
      userCtx,
    );

    expect(result.items[0]?.ownerName).toBe("Custom Owner");
    expect(result.items[0]?.creator?.displayName).toBe("Alpha");
  });
});

describe("BUG-CMS-8 — handleEntryGetById creator field", () => {
  let deps: ReturnType<typeof buildDeps>;

  beforeEach(() => {
    deps = buildDeps();
    deps.listEntryCollaboratorsByEntryIds.mockResolvedValue(new Map());
    deps.listFavoriteEntryIdsByUser.mockResolvedValue(new Set<string>());
  });

  it("attaches creator for a user-actor entry", async () => {
    deps.findEntryByIdAndWorkspace.mockResolvedValue(
      entryRow({ createdBy: HUMAN_USER_ID_ALPHA }),
    );
    deps.listEntryCreatorsByUserIds.mockResolvedValue(
      new Map([
        [HUMAN_USER_ID_ALPHA, { id: HUMAN_USER_ID_ALPHA, displayName: "Alpha" }],
      ]),
    );

    const handler = createHandleEntryGetById(deps as never);

    const result = await handler({ entryId: ENTRY_ID_A }, userCtx);

    expect(result.entry.creator).toEqual({
      id: HUMAN_USER_ID_ALPHA,
      displayName: "Alpha",
    });
  });

  it("returns creator: null for an api_key-created entry and skips the user lookup", async () => {
    deps.findEntryByIdAndWorkspace.mockResolvedValue(
      entryRow({ createdBy: null, updatedBy: null }),
    );

    const handler = createHandleEntryGetById(deps as never);
    const result = await handler({ entryId: ENTRY_ID_A }, userCtx);

    expect(result.entry.creator).toBeNull();
    expect(deps.listEntryCreatorsByUserIds).not.toHaveBeenCalled();
  });
});
