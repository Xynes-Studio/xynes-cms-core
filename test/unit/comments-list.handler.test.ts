import { describe, it, expect, beforeEach, vi } from "bun:test";
import { EntryNotFoundError } from "../../src/actions/errors";
import type { ActionContext } from "../../src/actions/types";
import {
  CommentsListForEntryPayloadSchema,
  createHandleCommentsListForEntry,
} from "../../src/actions/handlers/comments-list.handler";

const findEntryByIdAndWorkspace = vi.fn();
const findPublishedEntryByIdAndWorkspace = vi.fn();
const listCommentsForEntry = vi.fn();

const handleCommentsListForEntry = createHandleCommentsListForEntry({
  findEntryByIdAndWorkspace,
  findPublishedEntryByIdAndWorkspace,
  listCommentsForEntry,
});

type CmsCommentDTO = import("../../src/actions/handlers/comments-list.handler").CmsCommentDTO;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CommentsListForEntryPayloadSchema", () => {
  it("should validate valid payload with all fields", () => {
    const validPayload = {
      entryId: "550e8400-e29b-41d4-a716-446655440000",
      includeReplies: true,
      statusFilter: "approved" as const,
    };

    const result = CommentsListForEntryPayloadSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  it("should validate valid payload with minimal fields (entryId only)", () => {
    const minimalPayload = {
      entryId: "550e8400-e29b-41d4-a716-446655440000",
    };

    const result = CommentsListForEntryPayloadSchema.safeParse(minimalPayload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.includeReplies).toBe(true); // default
      expect(result.data.statusFilter).toBe("approved"); // default
    }
  });

  it("should apply default values correctly", () => {
    const payload = {
      entryId: "550e8400-e29b-41d4-a716-446655440000",
    };

    const result = CommentsListForEntryPayloadSchema.parse(payload);
    expect(result.includeReplies).toBe(true);
    expect(result.statusFilter).toBe("approved");
  });

  it("should accept statusFilter='pending'", () => {
    const payload = {
      entryId: "550e8400-e29b-41d4-a716-446655440000",
      statusFilter: "pending" as const,
    };

    const result = CommentsListForEntryPayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it("should accept statusFilter='all'", () => {
    const payload = {
      entryId: "550e8400-e29b-41d4-a716-446655440000",
      statusFilter: "all" as const,
    };

    const result = CommentsListForEntryPayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it("should accept includeReplies=false", () => {
    const payload = {
      entryId: "550e8400-e29b-41d4-a716-446655440000",
      includeReplies: false,
    };

    const result = CommentsListForEntryPayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.includeReplies).toBe(false);
    }
  });

  it("should reject missing entryId", () => {
    const invalidPayload = {
      statusFilter: "approved",
    };

    const result = CommentsListForEntryPayloadSchema.safeParse(invalidPayload);
    expect(result.success).toBe(false);
  });

  it("should reject invalid entryId (not UUID)", () => {
    const invalidPayload = {
      entryId: "not-a-uuid",
    };

    const result = CommentsListForEntryPayloadSchema.safeParse(invalidPayload);
    expect(result.success).toBe(false);
  });

  it("should reject invalid statusFilter value", () => {
    const invalidPayload = {
      entryId: "550e8400-e29b-41d4-a716-446655440000",
      statusFilter: "invalid-status",
    };

    const result = CommentsListForEntryPayloadSchema.safeParse(invalidPayload);
    expect(result.success).toBe(false);
  });

  it("should reject invalid includeReplies type", () => {
    const invalidPayload = {
      entryId: "550e8400-e29b-41d4-a716-446655440000",
      includeReplies: "yes", // should be boolean
    };

    const result = CommentsListForEntryPayloadSchema.safeParse(invalidPayload);
    expect(result.success).toBe(false);
  });
  it("should validate valid payload with pagination fields", () => {
    const payload = {
      entryId: "550e8400-e29b-41d4-a716-446655440000",
      limit: 50,
      offset: 10,
    };

    const result = CommentsListForEntryPayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(50);
      expect(result.data.offset).toBe(10);
    }
  });

  it("should apply default values for pagination", () => {
    const payload = {
      entryId: "550e8400-e29b-41d4-a716-446655440000",
    };

    const result = CommentsListForEntryPayloadSchema.parse(payload);
    expect(result.limit).toBe(20);
    expect(result.offset).toBe(0);
  });

  it("should reject invalid limit (negative)", () => {
    const payload = {
      entryId: "550e8400-e29b-41d4-a716-446655440000",
      limit: -1,
    };

    const result = CommentsListForEntryPayloadSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it("should clamp excessively large limit to max", () => {
    const payload = {
      entryId: "550e8400-e29b-41d4-a716-446655440000",
      limit: 10_000,
    };

    const result = CommentsListForEntryPayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(100);
    }
  });

  it("should reject invalid offset (negative)", () => {
    const payload = {
      entryId: "550e8400-e29b-41d4-a716-446655440000",
      offset: -5,
    };

    const result = CommentsListForEntryPayloadSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });
});

describe("CmsCommentDTO type", () => {
  it("should match expected shape", () => {
    const dto: CmsCommentDTO = {
      id: "uuid-123",
      parentId: null,
      displayName: "Test User",
      userId: null,
      content: "Test comment",
      status: "approved",
      createdAt: "2024-01-01T00:00:00.000Z",
    };

    expect(dto.id).toBe("uuid-123");
    expect(dto.parentId).toBeNull();
    expect(dto.displayName).toBe("Test User");
    expect(dto.createdAt).toBe("2024-01-01T00:00:00.000Z");
  });

  it("should accept parentId as string for replies", () => {
    const dto: CmsCommentDTO = {
      id: "uuid-456",
      parentId: "uuid-123",
      displayName: null,
      userId: "user-uuid",
      content: "Reply content",
      status: "pending",
      createdAt: "2024-01-02T00:00:00.000Z",
    };

    expect(dto.parentId).toBe("uuid-123");
    expect(dto.userId).toBe("user-uuid");
  });
});

describe("EntryNotFoundError", () => {
  it("should have correct message and name for entry ID", () => {
    const error = new EntryNotFoundError("entry-uuid-123");
    expect(error.message).toBe("Entry not found: entry-uuid-123");
    expect(error.name).toBe("EntryNotFoundError");
  });
});

describe("handleCommentsListForEntry", () => {
  const anonymousCtx: ActionContext = { workspaceId: "ws-1" };
  const authedCtx: ActionContext = { workspaceId: "ws-1", userId: "user-1" };

  describe("Anonymous Users (CMS-COMMENTS-PUBLIC-1)", () => {
    it("uses findPublishedEntryByIdAndWorkspace for anonymous users (security)", async () => {
      findPublishedEntryByIdAndWorkspace.mockResolvedValueOnce({ id: "e1" });
      listCommentsForEntry.mockResolvedValueOnce([]);

      await handleCommentsListForEntry(
        {
          entryId: "550e8400-e29b-41d4-a716-446655440000",
          includeReplies: true,
          statusFilter: "approved",
          limit: 20,
          offset: 0,
        },
        anonymousCtx,
      );

      expect(findPublishedEntryByIdAndWorkspace).toHaveBeenCalledWith(
        "550e8400-e29b-41d4-a716-446655440000",
        "ws-1",
      );
      expect(findEntryByIdAndWorkspace).not.toHaveBeenCalled();
    });

    it("throws EntryNotFoundError when entry is not published (anonymous security)", async () => {
      findPublishedEntryByIdAndWorkspace.mockResolvedValueOnce(null);

      await expect(
        handleCommentsListForEntry(
          {
            entryId: "550e8400-e29b-41d4-a716-446655440000",
            includeReplies: true,
            statusFilter: "approved",
            limit: 20,
            offset: 0,
          },
          anonymousCtx,
        ),
      ).rejects.toBeInstanceOf(EntryNotFoundError);
    });

    it("forces statusFilter=approved for anonymous context", async () => {
      findPublishedEntryByIdAndWorkspace.mockResolvedValueOnce({ id: "e1" });
      listCommentsForEntry.mockResolvedValueOnce([]);

      await handleCommentsListForEntry(
        {
          entryId: "550e8400-e29b-41d4-a716-446655440000",
          includeReplies: true,
          statusFilter: "pending", // should be overridden
          limit: 20,
          offset: 0,
        },
        anonymousCtx,
      );

      expect(listCommentsForEntry).toHaveBeenCalledWith(
        expect.objectContaining({ statusFilter: "approved" }),
      );
    });

    it("forces statusFilter=approved even when 'all' is requested by anonymous user", async () => {
      findPublishedEntryByIdAndWorkspace.mockResolvedValueOnce({ id: "e1" });
      listCommentsForEntry.mockResolvedValueOnce([]);

      await handleCommentsListForEntry(
        {
          entryId: "550e8400-e29b-41d4-a716-446655440000",
          includeReplies: true,
          statusFilter: "all",
          limit: 20,
          offset: 0,
        },
        anonymousCtx,
      );

      expect(listCommentsForEntry).toHaveBeenCalledWith(
        expect.objectContaining({ statusFilter: "approved" }),
      );
    });

    it("maps repository rows to DTOs with ISO date strings for anonymous users", async () => {
      findPublishedEntryByIdAndWorkspace.mockResolvedValueOnce({ id: "e1" });
      listCommentsForEntry.mockResolvedValueOnce([
        {
          id: "c1",
          parentId: null,
          displayName: "Alice",
          userId: null,
          content: "hello",
          status: "approved",
          createdAt: new Date("2024-01-01T00:00:00.000Z"),
        },
      ]);

      const res = await handleCommentsListForEntry(
        {
          entryId: "550e8400-e29b-41d4-a716-446655440000",
          includeReplies: true,
          statusFilter: "approved",
          limit: 20,
          offset: 0,
        },
        anonymousCtx,
      );

      const dto = res[0] as CmsCommentDTO;
      expect(dto.id).toBe("c1");
      expect(dto.createdAt).toBe("2024-01-01T00:00:00.000Z");
    });
  });

  describe("Authenticated Users", () => {
    it("uses findEntryByIdAndWorkspace for authenticated users", async () => {
      findEntryByIdAndWorkspace.mockResolvedValueOnce({ id: "e1" });
      listCommentsForEntry.mockResolvedValueOnce([]);

      await handleCommentsListForEntry(
        {
          entryId: "550e8400-e29b-41d4-a716-446655440000",
          includeReplies: true,
          statusFilter: "approved",
          limit: 20,
          offset: 0,
        },
        authedCtx,
      );

      expect(findEntryByIdAndWorkspace).toHaveBeenCalledWith(
        "550e8400-e29b-41d4-a716-446655440000",
        "ws-1",
      );
      expect(findPublishedEntryByIdAndWorkspace).not.toHaveBeenCalled();
    });

    it("throws EntryNotFoundError when entry does not exist in workspace", async () => {
      findEntryByIdAndWorkspace.mockResolvedValueOnce(null);

      await expect(
        handleCommentsListForEntry(
          {
            entryId: "550e8400-e29b-41d4-a716-446655440000",
            includeReplies: true,
            statusFilter: "approved",
            limit: 20,
            offset: 0,
          },
          authedCtx,
        ),
      ).rejects.toBeInstanceOf(EntryNotFoundError);
    });

    it("maps repository rows to DTOs with ISO date strings", async () => {
      findEntryByIdAndWorkspace.mockResolvedValueOnce({ id: "e1" });
      listCommentsForEntry.mockResolvedValueOnce([
        {
          id: "c1",
          parentId: null,
          displayName: "Alice",
          userId: null,
          content: "hello",
          status: "approved",
          createdAt: new Date("2024-01-01T00:00:00.000Z"),
        },
      ]);

      const res = await handleCommentsListForEntry(
        {
          entryId: "550e8400-e29b-41d4-a716-446655440000",
          includeReplies: true,
          statusFilter: "approved",
          limit: 20,
          offset: 0,
        },
        authedCtx,
      );

      const dto = res[0] as CmsCommentDTO;
      expect(dto.id).toBe("c1");
      expect(dto.createdAt).toBe("2024-01-01T00:00:00.000Z");
      expect(listCommentsForEntry).toHaveBeenCalledWith({
        workspaceId: "ws-1",
        entryId: "550e8400-e29b-41d4-a716-446655440000",
        statusFilter: "approved",
        limit: 20,
        offset: 0,
      });
    });

    it("clamps limit above max before querying repository", async () => {
      findEntryByIdAndWorkspace.mockResolvedValueOnce({ id: "e1" });
      listCommentsForEntry.mockResolvedValueOnce([]);

      const parsedPayload = CommentsListForEntryPayloadSchema.parse({
        entryId: "550e8400-e29b-41d4-a716-446655440000",
        includeReplies: true,
        statusFilter: "approved",
        limit: 10_000,
        offset: 0,
      });

      await handleCommentsListForEntry(parsedPayload, authedCtx);

      expect(listCommentsForEntry).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 100 }),
      );
    });

    it("allows statusFilter=pending for authenticated context", async () => {
      findEntryByIdAndWorkspace.mockResolvedValueOnce({ id: "e1" });
      listCommentsForEntry.mockResolvedValueOnce([]);

      await handleCommentsListForEntry(
        {
          entryId: "550e8400-e29b-41d4-a716-446655440000",
          includeReplies: true,
          statusFilter: "pending",
          limit: 20,
          offset: 0,
        },
        authedCtx,
      );

      expect(listCommentsForEntry).toHaveBeenCalledWith(
        expect.objectContaining({ statusFilter: "pending" }),
      );
    });

    it("allows statusFilter=all for authenticated context", async () => {
      findEntryByIdAndWorkspace.mockResolvedValueOnce({ id: "e1" });
      listCommentsForEntry.mockResolvedValueOnce([]);

      await handleCommentsListForEntry(
        {
          entryId: "550e8400-e29b-41d4-a716-446655440000",
          includeReplies: true,
          statusFilter: "all",
          limit: 20,
          offset: 0,
        },
        authedCtx,
      );

      expect(listCommentsForEntry).toHaveBeenCalledWith(
        expect.objectContaining({ statusFilter: "all" }),
      );
    });
  });
});
