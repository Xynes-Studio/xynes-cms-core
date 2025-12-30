import { describe, it, expect, beforeEach, vi } from "bun:test";
import {
  EntryNotFoundError,
  CommentNotFoundError,
  ValidationError,
} from "../../src/actions/errors";
import type { ActionContext } from "../../src/actions/types";
import {
  CommentsCreatePayloadSchema,
  createHandleCommentsCreate,
} from "../../src/actions/handlers/comments-create.handler";

const findEntryByIdAndWorkspace = vi.fn();
const findPublishedEntryByIdAndWorkspace = vi.fn();
const findCommentByIdAndEntry = vi.fn();
const createComment = vi.fn();

const handleCommentsCreate = createHandleCommentsCreate({
  findEntryByIdAndWorkspace,
  findPublishedEntryByIdAndWorkspace,
  findCommentByIdAndEntry,
  createComment,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CommentsCreatePayloadSchema", () => {
  it("should validate valid payload with all fields", () => {
    const validPayload = {
      entryId: "550e8400-e29b-41d4-a716-446655440000",
      parentId: "660e8400-e29b-41d4-a716-446655440001",
      displayName: "Test User",
      content: "This is a test comment",
    };

    const result = CommentsCreatePayloadSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  it("should validate valid payload with minimal fields (entryId, content)", () => {
    const minimalPayload = {
      entryId: "550e8400-e29b-41d4-a716-446655440000",
      content: "Minimal comment content",
    };

    const result = CommentsCreatePayloadSchema.safeParse(minimalPayload);
    expect(result.success).toBe(true);
  });

  it("should accept null parentId", () => {
    const payload = {
      entryId: "550e8400-e29b-41d4-a716-446655440000",
      parentId: null,
      content: "Top-level comment",
    };

    const result = CommentsCreatePayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it("should accept null displayName", () => {
    const payload = {
      entryId: "550e8400-e29b-41d4-a716-446655440000",
      displayName: null,
      content: "Anonymous comment",
    };

    const result = CommentsCreatePayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it("should reject missing entryId", () => {
    const invalidPayload = {
      content: "No entry ID",
    };

    const result = CommentsCreatePayloadSchema.safeParse(invalidPayload);
    expect(result.success).toBe(false);
  });

  it("should reject invalid entryId (not UUID)", () => {
    const invalidPayload = {
      entryId: "not-a-uuid",
      content: "Invalid entry ID",
    };

    const result = CommentsCreatePayloadSchema.safeParse(invalidPayload);
    expect(result.success).toBe(false);
  });

  it("should reject invalid parentId (not UUID)", () => {
    const invalidPayload = {
      entryId: "550e8400-e29b-41d4-a716-446655440000",
      parentId: "not-a-uuid",
      content: "Invalid parent ID",
    };

    const result = CommentsCreatePayloadSchema.safeParse(invalidPayload);
    expect(result.success).toBe(false);
  });

  it("should reject missing content", () => {
    const invalidPayload = {
      entryId: "550e8400-e29b-41d4-a716-446655440000",
    };

    const result = CommentsCreatePayloadSchema.safeParse(invalidPayload);
    expect(result.success).toBe(false);
  });

  it("should reject empty content", () => {
    const invalidPayload = {
      entryId: "550e8400-e29b-41d4-a716-446655440000",
      content: "",
    };

    const result = CommentsCreatePayloadSchema.safeParse(invalidPayload);
    expect(result.success).toBe(false);
  });

  it("should reject excessively long content", () => {
    const invalidPayload = {
      entryId: "550e8400-e29b-41d4-a716-446655440000",
      content: "a".repeat(4001),
    };

    const result = CommentsCreatePayloadSchema.safeParse(invalidPayload);
    expect(result.success).toBe(false);
  });

  it("should reject excessively long displayName", () => {
    const invalidPayload = {
      entryId: "550e8400-e29b-41d4-a716-446655440000",
      displayName: "a".repeat(101),
      content: "Valid content",
    };

    const result = CommentsCreatePayloadSchema.safeParse(invalidPayload);
    expect(result.success).toBe(false);
  });

  it("should accept displayName at max length (100 chars)", () => {
    const validPayload = {
      entryId: "550e8400-e29b-41d4-a716-446655440000",
      displayName: "a".repeat(100),
      content: "Valid content",
    };

    const result = CommentsCreatePayloadSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });
});

describe("Comments Error Classes", () => {
  it("CommentNotFoundError should have correct message and name", () => {
    const error = new CommentNotFoundError("comment-123");
    expect(error.message).toBe("Comment not found: comment-123");
    expect(error.name).toBe("CommentNotFoundError");
  });

  it("EntryNotFoundError should work with entry ID", () => {
    const error = new EntryNotFoundError("entry-456");
    expect(error.message).toBe("Entry not found: entry-456");
    expect(error.name).toBe("EntryNotFoundError");
  });
});

describe("handleCommentsCreate - Authenticated Users", () => {
  const ctx: ActionContext = { workspaceId: "ws-1", userId: "user-1" };

  it("throws EntryNotFoundError when entry does not exist in workspace", async () => {
    findEntryByIdAndWorkspace.mockResolvedValueOnce(null);

    await expect(
      handleCommentsCreate(
        { entryId: "550e8400-e29b-41d4-a716-446655440000", content: "hi" },
        ctx,
      ),
    ).rejects.toBeInstanceOf(EntryNotFoundError);

    expect(findEntryByIdAndWorkspace).toHaveBeenCalledWith(
      "550e8400-e29b-41d4-a716-446655440000",
      "ws-1",
    );
  });

  it("uses findEntryByIdAndWorkspace (not published check) for authenticated users", async () => {
    findEntryByIdAndWorkspace.mockResolvedValueOnce({ id: "e1" });
    createComment.mockResolvedValueOnce({
      id: "c1",
      entryId: "e1",
      workspaceId: "ws-1",
    });

    await handleCommentsCreate(
      {
        entryId: "550e8400-e29b-41d4-a716-446655440000",
        displayName: "Alice",
        content: "hello",
      },
      ctx,
    );

    expect(findEntryByIdAndWorkspace).toHaveBeenCalled();
    expect(findPublishedEntryByIdAndWorkspace).not.toHaveBeenCalled();
  });

  it("throws CommentNotFoundError when parentId is provided but missing", async () => {
    findEntryByIdAndWorkspace.mockResolvedValueOnce({ id: "e1" });
    findCommentByIdAndEntry.mockResolvedValueOnce(null);

    await expect(
      handleCommentsCreate(
        {
          entryId: "550e8400-e29b-41d4-a716-446655440000",
          parentId: "660e8400-e29b-41d4-a716-446655440001",
          content: "reply",
        },
        ctx,
      ),
    ).rejects.toBeInstanceOf(CommentNotFoundError);
  });

  it("creates a comment and passes userId/displayName through context/payload", async () => {
    findEntryByIdAndWorkspace.mockResolvedValueOnce({ id: "e1" });
    createComment.mockResolvedValueOnce({
      id: "c1",
      entryId: "e1",
      workspaceId: "ws-1",
    });

    const res = await handleCommentsCreate(
      {
        entryId: "550e8400-e29b-41d4-a716-446655440000",
        displayName: "Alice",
        content: "hello",
      },
      ctx,
    );

    expect(createComment).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      entryId: "550e8400-e29b-41d4-a716-446655440000",
      parentId: null,
      userId: "user-1",
      displayName: "Alice",
      content: "hello",
    });
    expect(res.id).toBe("c1");
  });

  it("allows authenticated users to post longer comments (up to 4000 chars)", async () => {
    findEntryByIdAndWorkspace.mockResolvedValueOnce({ id: "e1" });
    createComment.mockResolvedValueOnce({
      id: "c1",
      entryId: "e1",
      workspaceId: "ws-1",
    });

    const longContent = "a".repeat(3000);

    await expect(
      handleCommentsCreate(
        {
          entryId: "550e8400-e29b-41d4-a716-446655440000",
          content: longContent,
        },
        ctx,
      ),
    ).resolves.toBeDefined();
  });

  it("authenticated users can comment without displayName", async () => {
    findEntryByIdAndWorkspace.mockResolvedValueOnce({ id: "e1" });
    createComment.mockResolvedValueOnce({
      id: "c1",
      entryId: "e1",
      workspaceId: "ws-1",
    });

    await expect(
      handleCommentsCreate(
        {
          entryId: "550e8400-e29b-41d4-a716-446655440000",
          content: "hello",
        },
        ctx,
      ),
    ).resolves.toBeDefined();

    expect(createComment).toHaveBeenCalledWith(
      expect.objectContaining({
        displayName: null,
      }),
    );
  });
});

describe("handleCommentsCreate - Anonymous Users (CMS-COMMENTS-PUBLIC-1)", () => {
  const anonymousCtx: ActionContext = { workspaceId: "ws-1" };

  it("uses findPublishedEntryByIdAndWorkspace for anonymous users (security)", async () => {
    findPublishedEntryByIdAndWorkspace.mockResolvedValueOnce({ id: "e1" });
    createComment.mockResolvedValueOnce({
      id: "c1",
      entryId: "e1",
      workspaceId: "ws-1",
    });

    await handleCommentsCreate(
      {
        entryId: "550e8400-e29b-41d4-a716-446655440000",
        displayName: "Guest",
        content: "hello",
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
      handleCommentsCreate(
        {
          entryId: "550e8400-e29b-41d4-a716-446655440000",
          displayName: "Guest",
          content: "trying to comment on draft",
        },
        anonymousCtx,
      ),
    ).rejects.toBeInstanceOf(EntryNotFoundError);
  });

  it("rejects overly long content for anonymous users (max 1000 chars)", async () => {
    await expect(
      handleCommentsCreate(
        {
          entryId: "550e8400-e29b-41d4-a716-446655440000",
          displayName: "Guest",
          content: "a".repeat(1001),
        },
        anonymousCtx,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("accepts content at max anonymous length (1000 chars)", async () => {
    findPublishedEntryByIdAndWorkspace.mockResolvedValueOnce({ id: "e1" });
    createComment.mockResolvedValueOnce({
      id: "c1",
      entryId: "e1",
      workspaceId: "ws-1",
    });

    const maxContent = "a".repeat(1000);

    await expect(
      handleCommentsCreate(
        {
          entryId: "550e8400-e29b-41d4-a716-446655440000",
          displayName: "Guest",
          content: maxContent,
        },
        anonymousCtx,
      ),
    ).resolves.toBeDefined();
  });

  it("requires displayName for anonymous users", async () => {
    await expect(
      handleCommentsCreate(
        {
          entryId: "550e8400-e29b-41d4-a716-446655440000",
          content: "hello",
        },
        anonymousCtx,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects empty displayName for anonymous users", async () => {
    await expect(
      handleCommentsCreate(
        {
          entryId: "550e8400-e29b-41d4-a716-446655440000",
          displayName: "",
          content: "hello",
        },
        anonymousCtx,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects whitespace-only displayName for anonymous users", async () => {
    await expect(
      handleCommentsCreate(
        {
          entryId: "550e8400-e29b-41d4-a716-446655440000",
          displayName: "   ",
          content: "hello",
        },
        anonymousCtx,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("creates anonymous comment with pending status and null userId", async () => {
    findPublishedEntryByIdAndWorkspace.mockResolvedValueOnce({ id: "e1" });
    createComment.mockResolvedValueOnce({
      id: "c1",
      entryId: "e1",
      workspaceId: "ws-1",
      userId: null,
      status: "pending",
    });

    const res = await handleCommentsCreate(
      {
        entryId: "550e8400-e29b-41d4-a716-446655440000",
        displayName: "Guest User",
        content: "Great article!",
      },
      anonymousCtx,
    );

    expect(createComment).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      entryId: "550e8400-e29b-41d4-a716-446655440000",
      parentId: null,
      userId: null,
      displayName: "Guest User",
      content: "Great article!",
    });
    expect(res.userId).toBeNull();
  });

  it("allows anonymous threaded replies when parent comment exists", async () => {
    findPublishedEntryByIdAndWorkspace.mockResolvedValueOnce({ id: "e1" });
    findCommentByIdAndEntry.mockResolvedValueOnce({ id: "parent-1" });
    createComment.mockResolvedValueOnce({
      id: "c1",
      parentId: "parent-1",
    });

    const res = await handleCommentsCreate(
      {
        entryId: "550e8400-e29b-41d4-a716-446655440000",
        parentId: "660e8400-e29b-41d4-a716-446655440001",
        displayName: "Guest",
        content: "Great reply!",
      },
      anonymousCtx,
    );

    expect(res.parentId).toBe("parent-1");
  });
});
