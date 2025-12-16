import { describe, it, expect } from "bun:test";
import { z } from "zod";
import {
  BlogEntryCreatePayloadSchema,
  BlogEntryReadPayloadSchema,
  BlogEntryListPublishedPayloadSchema,
  BlogEntryGetPublishedBySlugPayloadSchema,
  BlogEntryListAdminPayloadSchema,
  BlogEntryDataSchema,
} from "../../src/actions/handlers/blog-entry.handler";
import {
  ContentTypeAccessDeniedError,
  ContentTypeNotFoundError,
  EntryNotFoundError,
} from "../../src/actions/errors";

describe("Blog Entry Schemas", () => {
  describe("BlogEntryDataSchema", () => {
    it("should validate valid blog entry data", () => {
      const validData = {
        slug: "hello-world",
        title: "Hello World",
        excerpt: "A brief description",
        tags: ["typescript", "testing"],
        coverImageUrl: "https://example.com/image.jpg",
        publishedAt: "2024-01-01T00:00:00Z",
      };

      const result = BlogEntryDataSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it("should accept minimal valid data (only required fields)", () => {
      const minimalData = {
        slug: "minimal-post",
        title: "Minimal Post",
      };

      const result = BlogEntryDataSchema.safeParse(minimalData);
      expect(result.success).toBe(true);
    });

    it("should reject data with missing required slug", () => {
      const invalidData = { title: "No Slug" };

      const result = BlogEntryDataSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it("should reject data with missing required title", () => {
      const invalidData = { slug: "no-title" };

      const result = BlogEntryDataSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it("should reject empty slug", () => {
      const invalidData = { slug: "", title: "Valid Title" };

      const result = BlogEntryDataSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it("should reject invalid coverImageUrl", () => {
      const invalidData = {
        slug: "test",
        title: "Test",
        coverImageUrl: "not-a-url",
      };

      const result = BlogEntryDataSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it("should accept null publishedAt", () => {
      const validData = {
        slug: "draft-post",
        title: "Draft Post",
        publishedAt: null,
      };

      const result = BlogEntryDataSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });
  });

  describe("BlogEntryCreatePayloadSchema", () => {
    it("should validate valid create payload", () => {
      const validPayload = {
        contentTypeId: "550e8400-e29b-41d4-a716-446655440000",
        data: {
          slug: "test-post",
          title: "Test Post",
        },
      };

      const result = BlogEntryCreatePayloadSchema.safeParse(validPayload);
      expect(result.success).toBe(true);
    });

    it("should accept optional documentId", () => {
      const validPayload = {
        contentTypeId: "550e8400-e29b-41d4-a716-446655440000",
        documentId: "660e8400-e29b-41d4-a716-446655440001",
        data: {
          slug: "test-post",
          title: "Test Post",
        },
      };

      const result = BlogEntryCreatePayloadSchema.safeParse(validPayload);
      expect(result.success).toBe(true);
    });

    it("should reject invalid contentTypeId (not UUID)", () => {
      const invalidPayload = {
        contentTypeId: "not-a-uuid",
        data: { slug: "test", title: "Test" },
      };

      const result = BlogEntryCreatePayloadSchema.safeParse(invalidPayload);
      expect(result.success).toBe(false);
    });

    it("should reject missing data", () => {
      const invalidPayload = {
        contentTypeId: "550e8400-e29b-41d4-a716-446655440000",
      };

      const result = BlogEntryCreatePayloadSchema.safeParse(invalidPayload);
      expect(result.success).toBe(false);
    });

    it("should accept optional publishNow", () => {
      const validPayload = {
        contentTypeId: "550e8400-e29b-41d4-a716-446655440000",
        publishNow: true,
        data: {
          slug: "test-post",
          title: "Test Post",
        },
      };

      const result = BlogEntryCreatePayloadSchema.safeParse(validPayload);
      expect(result.success).toBe(true);
    });

    it("should accept publishNow inside data object", () => {
      const validPayload = {
        contentTypeId: "550e8400-e29b-41d4-a716-446655440000",
        data: {
          slug: "test-post",
          title: "Test Post",
          publishNow: true,
        },
      };

      const result = BlogEntryCreatePayloadSchema.safeParse(validPayload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.data.publishNow).toBe(true);
      }
    });
  });

  describe("BlogEntryReadPayloadSchema", () => {
    it("should validate payload with contentTypeId only", () => {
      const validPayload = {
        contentTypeId: "550e8400-e29b-41d4-a716-446655440000",
      };

      const result = BlogEntryReadPayloadSchema.safeParse(validPayload);
      expect(result.success).toBe(true);
    });

    it("should accept optional slug", () => {
      const validPayload = {
        contentTypeId: "550e8400-e29b-41d4-a716-446655440000",
        slug: "specific-post",
      };

      const result = BlogEntryReadPayloadSchema.safeParse(validPayload);
      expect(result.success).toBe(true);
    });

    it("should reject missing contentTypeId", () => {
      const invalidPayload = {
        slug: "orphan-slug",
      };

      const result = BlogEntryReadPayloadSchema.safeParse(invalidPayload);
      expect(result.success).toBe(false);
    });
  });
  describe("BlogEntryListPublishedPayloadSchema", () => {
    it("should validate empty payload (defaults apply)", () => {
      const validPayload = {};
      const result = BlogEntryListPublishedPayloadSchema.safeParse(validPayload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.limit).toBe(10);
        expect(result.data.offset).toBe(0);
      }
    });

    it("should validate payload with optional fields", () => {
      const validPayload = {
        limit: 20,
        offset: 10,
        tag: "news",
      };
      const result = BlogEntryListPublishedPayloadSchema.safeParse(validPayload);
      expect(result.success).toBe(true);
    });

    it("should reject invalid types", () => {
      const invalidPayload = {
        limit: "10", // string instead of number
      };
      const result = BlogEntryListPublishedPayloadSchema.safeParse(invalidPayload);
      expect(result.success).toBe(false);
    });
  });

  describe("BlogEntryGetPublishedBySlugPayloadSchema", () => {
    it("should validate payload with required slug", () => {
      const validPayload = {
        slug: "my-post",
      };
      const result = BlogEntryGetPublishedBySlugPayloadSchema.safeParse(validPayload);
      expect(result.success).toBe(true);
    });

    it("should reject missing slug", () => {
      const invalidPayload = {};
      const result = BlogEntryGetPublishedBySlugPayloadSchema.safeParse(invalidPayload);
      expect(result.success).toBe(false);
    });

    it("should reject empty slug", () => {
      const invalidPayload = { slug: "" };
      const result = BlogEntryGetPublishedBySlugPayloadSchema.safeParse(invalidPayload);
      expect(result.success).toBe(false);
    });
  });

  describe("BlogEntryListAdminPayloadSchema", () => {
    it("should validate empty payload (defaults apply)", () => {
      const result = BlogEntryListAdminPayloadSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.status).toBe("all");
        expect(result.data.limit).toBe(20);
        expect(result.data.offset).toBe(0);
      }
    });

    it("should accept all status values", () => {
      for (const status of ["draft", "published", "archived", "all"] as const) {
        const result = BlogEntryListAdminPayloadSchema.safeParse({ status, limit: 10, offset: 0 });
        expect(result.success).toBe(true);
      }
    });

    it("should reject invalid status", () => {
      const result = BlogEntryListAdminPayloadSchema.safeParse({ status: "nope" });
      expect(result.success).toBe(false);
    });

    it("should reject limit > 100", () => {
      const result = BlogEntryListAdminPayloadSchema.safeParse({ limit: 101 });
      expect(result.success).toBe(false);
    });

    it("should reject limit < 1", () => {
      const result = BlogEntryListAdminPayloadSchema.safeParse({ limit: 0 });
      expect(result.success).toBe(false);
    });

    it("should reject negative offset", () => {
      const result = BlogEntryListAdminPayloadSchema.safeParse({ offset: -1 });
      expect(result.success).toBe(false);
    });

    it("should trim search and reject empty search after trimming", () => {
      const trimmed = BlogEntryListAdminPayloadSchema.safeParse({ search: "  Hello  " });
      expect(trimmed.success).toBe(true);
      if (trimmed.success) {
        expect(trimmed.data.search).toBe("Hello");
      }

      const empty = BlogEntryListAdminPayloadSchema.safeParse({ search: "   " });
      expect(empty.success).toBe(false);
    });

    it("should reject overly long search strings", () => {
      const tooLong = "a".repeat(201);
      const result = BlogEntryListAdminPayloadSchema.safeParse({ search: tooLong });
      expect(result.success).toBe(false);
    });
  });
});

describe("CMS Action Errors", () => {
  it("ContentTypeNotFoundError should have correct message", () => {
    const error = new ContentTypeNotFoundError("ct-123");
    expect(error.message).toBe("Content type not found: ct-123");
    expect(error.name).toBe("ContentTypeNotFoundError");
  });

  it("ContentTypeAccessDeniedError should have correct message", () => {
    const error = new ContentTypeAccessDeniedError("ct-123", "ws-456");
    expect(error.message).toBe("Content type ct-123 does not belong to workspace ws-456");
    expect(error.name).toBe("ContentTypeAccessDeniedError");
  });

  it("EntryNotFoundError should have correct message", () => {
    const error = new EntryNotFoundError("my-slug");
    expect(error.message).toBe("Entry not found: my-slug");
    expect(error.name).toBe("EntryNotFoundError");
  });
});
