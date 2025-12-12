import { describe, it, expect } from "bun:test";
import {
  CommentsListForEntryPayloadSchema,
  type CmsCommentDTO,
} from "../../src/actions/handlers/comments-list.handler";
import { EntryNotFoundError } from "../../src/actions/errors";

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
