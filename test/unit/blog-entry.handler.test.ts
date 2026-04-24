import { describe, it, expect, beforeEach, vi } from "bun:test";
import { z } from "zod";
import type { ActionContext } from "../../src/actions/types";
import {
  ContentTypeAccessDeniedError,
  ContentTypeNotFoundError,
  EntryNotFoundError,
} from "../../src/actions/errors";
import {
  BlogEntryCreatePayloadSchema,
  BlogEntryDataSchema,
  BlogEntryGetPublishedBySlugPayloadSchema,
  BlogEntryListAdminPayloadSchema,
  BlogEntryListPublishedPayloadSchema,
  BlogEntryReadPayloadSchema,
  createHandleBlogEntryCreate,
  createHandleBlogEntryGetPublishedBySlug,
  createHandleBlogEntryListAdmin,
  createHandleBlogEntryListPublished,
  createHandleBlogEntryRead,
} from "../../src/actions/handlers/blog-entry.handler";
import {
  BlogEntryUpdateMetaPayloadSchema,
  applyBlogEntryMetaUpdate,
  createHandleBlogEntryUpdateMeta,
} from "../../src/actions/handlers/blog-entry-update-meta.handler";

const createEntry = vi.fn();
const findEntryBySlug = vi.fn();
const findPublishedEntryBySlug = vi.fn();
const listAdminEntries = vi.fn();
const listEntriesByContentType = vi.fn();
const listPublishedEntries = vi.fn();
const findEntryByIdAndWorkspace = vi.fn();
const updateEntryByIdAndWorkspace = vi.fn();

const findContentTypeByIdAndWorkspace = vi.fn();
const findContentTypeByTemplateKey = vi.fn();

const blogEntryDeps = {
  createEntry,
  findEntryBySlug,
  findPublishedEntryBySlug,
  listAdminEntries,
  listEntriesByContentType,
  listPublishedEntries,
  findContentTypeByIdAndWorkspace,
  findContentTypeByTemplateKey,
};

const handleBlogEntryCreate = createHandleBlogEntryCreate(blogEntryDeps as any);
const handleBlogEntryRead = createHandleBlogEntryRead(blogEntryDeps as any);
const handleBlogEntryListPublished = createHandleBlogEntryListPublished(
  blogEntryDeps as any,
);
const handleBlogEntryGetPublishedBySlug =
  createHandleBlogEntryGetPublishedBySlug(blogEntryDeps as any);
const handleBlogEntryListAdmin = createHandleBlogEntryListAdmin(
  blogEntryDeps as any,
);

const handleBlogEntryUpdateMeta = createHandleBlogEntryUpdateMeta({
  findEntryByIdAndWorkspace,
  updateEntryByIdAndWorkspace,
  findContentTypeByIdAndWorkspace,
} as any);

beforeEach(() => {
  vi.clearAllMocks();
});

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

    it("should clamp excessively large limit to max", () => {
      const payload = { limit: 10_000 };
      const result = BlogEntryListPublishedPayloadSchema.safeParse(payload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.limit).toBe(100);
      }
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

  describe("BlogEntryUpdateMetaPayloadSchema", () => {
    it("should validate metadata update only", () => {
      const validPayload = {
        id: "550e8400-e29b-41d4-a716-446655440000",
        data: {
          title: "Updated Title",
          tags: ["news", "updates"],
        },
      };

      const result = BlogEntryUpdateMetaPayloadSchema.safeParse(validPayload);
      expect(result.success).toBe(true);
    });

    it("should validate publishNow only", () => {
      const validPayload = {
        id: "550e8400-e29b-41d4-a716-446655440000",
        publishNow: true,
      };

      const result = BlogEntryUpdateMetaPayloadSchema.safeParse(validPayload);
      expect(result.success).toBe(true);
    });

    it("should validate unpublish only", () => {
      const validPayload = {
        id: "550e8400-e29b-41d4-a716-446655440000",
        unpublish: true,
      };

      const result = BlogEntryUpdateMetaPayloadSchema.safeParse(validPayload);
      expect(result.success).toBe(true);
    });

    it("should reject empty update (no data, publishNow, unpublish)", () => {
      const invalidPayload = {
        id: "550e8400-e29b-41d4-a716-446655440000",
      };

      const result = BlogEntryUpdateMetaPayloadSchema.safeParse(invalidPayload);
      expect(result.success).toBe(false);
    });

    it("should reject invalid combinations (publishNow and unpublish both true)", () => {
      const invalidPayload = {
        id: "550e8400-e29b-41d4-a716-446655440000",
        publishNow: true,
        unpublish: true,
      };

      const result = BlogEntryUpdateMetaPayloadSchema.safeParse(invalidPayload);
      expect(result.success).toBe(false);
    });
  });

  describe("applyBlogEntryMetaUpdate", () => {
    it("should merge metadata patch without dropping other fields", () => {
      const now = new Date("2025-01-01T00:00:00.000Z");

      const current = {
        data: {
          slug: "original-slug",
          title: "Original Title",
          excerpt: "Original excerpt",
          tags: ["a", "b"],
          extraField: "keep-me",
        },
        status: "draft" as const,
        publishedAt: null,
      };

      const next = applyBlogEntryMetaUpdate(
        current,
        { data: { title: "New Title", tags: ["x"] } },
        now,
      );

      expect(next.data.slug).toBe("original-slug");
      expect(next.data.title).toBe("New Title");
      expect(next.data.excerpt).toBe("Original excerpt");
      expect(next.data.tags).toEqual(["x"]);
      expect(next.data.extraField).toBe("keep-me");
      expect(next.status).toBe("draft");
      expect(next.publishedAt).toBeNull();
    });

    it("should set published status and overwrite publishedAt when publishNow is true", () => {
      const now = new Date("2025-01-02T03:04:05.000Z");

      const current = {
        data: { slug: "s", title: "t" },
        status: "draft" as const,
        publishedAt: null,
      };

      const next = applyBlogEntryMetaUpdate(
        current,
        { publishNow: true },
        now,
      );

      expect(next.status).toBe("published");
      expect(next.publishedAt).toEqual(now);
    });

    it("should set draft status and clear publishedAt when unpublish is true", () => {
      const now = new Date("2025-01-02T03:04:05.000Z");

      const current = {
        data: { slug: "s", title: "t" },
        status: "published" as const,
        publishedAt: new Date("2024-01-01T00:00:00.000Z"),
      };

      const next = applyBlogEntryMetaUpdate(
        current,
        { unpublish: true },
        now,
      );

      expect(next.status).toBe("draft");
      expect(next.publishedAt).toBeNull();
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

describe("Blog Entry Handlers (Unit)", () => {
  const ctx: ActionContext = { workspaceId: "ws-1", userId: "user-1" };

  describe("handleBlogEntryCreate", () => {
    it("throws ContentTypeAccessDeniedError when contentType is not in workspace", async () => {
      findContentTypeByIdAndWorkspace.mockResolvedValueOnce(null);

      await expect(
        handleBlogEntryCreate(
          {
            contentTypeId: "550e8400-e29b-41d4-a716-446655440000",
            data: { slug: "s", title: "t" },
          },
          ctx,
        ),
      ).rejects.toBeInstanceOf(ContentTypeAccessDeniedError);
    });

    it("creates a published entry when publishNow is true", async () => {
      findContentTypeByIdAndWorkspace.mockResolvedValueOnce({
        id: "ct-1",
        templateKey: "blog_post",
      });
      createEntry.mockImplementationOnce(async (input: any) => ({
        id: "e-1",
        ...input,
      }));

      const res = await handleBlogEntryCreate(
        {
          contentTypeId: "550e8400-e29b-41d4-a716-446655440000",
          publishNow: true,
          data: { slug: "s", title: "t" },
        },
        ctx,
      );

      expect(res.success).toBe(true);
      expect(createEntry).toHaveBeenCalledTimes(1);
      const arg = createEntry.mock.calls[0]?.[0] as any;
      expect(arg.workspaceId).toBe("ws-1");
      expect(arg.status).toBe("published");
      expect(arg.publishedAt).toBeInstanceOf(Date);
      expect(arg.createdBy).toBe("user-1");
      expect(arg.updatedBy).toBe("user-1");
    });

    it("uses explicit data.publishedAt when provided (overrides publishNow timing)", async () => {
      findContentTypeByIdAndWorkspace.mockResolvedValueOnce({
        id: "ct-1",
        templateKey: "blog_post",
      });
      createEntry.mockImplementationOnce(async (input: any) => ({
        id: "e-1",
        ...input,
      }));

      const res = await handleBlogEntryCreate(
        {
          contentTypeId: "550e8400-e29b-41d4-a716-446655440000",
          publishNow: true,
          data: {
            slug: "s",
            title: "t",
            publishedAt: "2024-02-03T04:05:06.000Z",
          },
        },
        ctx,
      );

      expect(res.success).toBe(true);
      const arg = createEntry.mock.calls[0]?.[0] as any;
      expect(arg.status).toBe("published");
      expect(arg.publishedAt?.toISOString()).toBe("2024-02-03T04:05:06.000Z");
    });
  });

  describe("handleBlogEntryRead", () => {
    it("returns a single entry when slug is provided", async () => {
      findContentTypeByIdAndWorkspace.mockResolvedValueOnce({ id: "ct-1" });
      findEntryBySlug.mockResolvedValueOnce({ id: "e-1", data: { slug: "s" } });

      const res = await handleBlogEntryRead(
        {
          contentTypeId: "550e8400-e29b-41d4-a716-446655440000",
          slug: "s",
        },
        ctx,
      );

      expect(res.entry.id).toBe("e-1");
    });

    it("returns a list of entries when slug is missing", async () => {
      findContentTypeByIdAndWorkspace.mockResolvedValueOnce({ id: "ct-1" });
      listEntriesByContentType.mockResolvedValueOnce([{ id: "e-1" }]);

      const res = await handleBlogEntryRead(
        { contentTypeId: "550e8400-e29b-41d4-a716-446655440000" },
        ctx,
      );

      expect(res.entries).toHaveLength(1);
    });

    it("throws EntryNotFoundError when slug is provided but entry is missing", async () => {
      findContentTypeByIdAndWorkspace.mockResolvedValueOnce({ id: "ct-1" });
      findEntryBySlug.mockResolvedValueOnce(null);

      await expect(
        handleBlogEntryRead(
          {
            contentTypeId: "550e8400-e29b-41d4-a716-446655440000",
            slug: "missing",
          },
          ctx,
        ),
      ).rejects.toBeInstanceOf(EntryNotFoundError);
    });
  });

  describe("handleBlogEntryListPublished", () => {
    it("throws ContentTypeNotFoundError when blog_post contentType is missing", async () => {
      findContentTypeByTemplateKey.mockResolvedValueOnce(null);

      await expect(
        handleBlogEntryListPublished({ limit: 10, offset: 0 }, ctx),
      ).rejects.toBeInstanceOf(ContentTypeNotFoundError);
    });

    it("clamps limit above max before querying repository", async () => {
      findContentTypeByTemplateKey.mockResolvedValueOnce({ id: "ct-1" });
      listPublishedEntries.mockResolvedValueOnce([]);

      const parsedPayload = BlogEntryListPublishedPayloadSchema.parse({
        limit: 10_000,
        offset: 0,
      });

      await handleBlogEntryListPublished(parsedPayload, ctx);

      expect(listPublishedEntries).toHaveBeenCalledWith(
        "ws-1",
        "ct-1",
        100,
        0,
        undefined,
      );
    });

    it("maps published entries to a simplified response", async () => {
      findContentTypeByTemplateKey.mockResolvedValueOnce({ id: "ct-1" });
      listPublishedEntries.mockResolvedValueOnce([
        {
          id: "e-1",
          data: {
            slug: "s",
            title: "t",
            excerpt: "x",
            tags: ["a"],
            coverImageUrl: "u",
          },
          publishedAt: new Date("2024-01-01T00:00:00.000Z"),
          documentId: "doc-1",
        },
      ]);

      const res = await handleBlogEntryListPublished({ limit: 10, offset: 0 }, ctx);
      expect(res.entries[0]?.slug).toBe("s");
      expect(res.entries[0]?.publishedAt?.toISOString()).toBe("2024-01-01T00:00:00.000Z");
    });
  });

  describe("handleBlogEntryGetPublishedBySlug", () => {
    it("throws EntryNotFoundError when slug is not found", async () => {
      findContentTypeByTemplateKey.mockResolvedValueOnce({ id: "ct-1" });
      findPublishedEntryBySlug.mockResolvedValueOnce(null);

      await expect(
        handleBlogEntryGetPublishedBySlug({ slug: "missing" }, ctx),
      ).rejects.toBeInstanceOf(EntryNotFoundError);
    });

    it("returns a mapped published entry", async () => {
      findContentTypeByTemplateKey.mockResolvedValueOnce({ id: "ct-1" });
      findPublishedEntryBySlug.mockResolvedValueOnce({
        id: "e-1",
        data: { slug: "s", title: "t" },
        publishedAt: new Date("2024-01-01T00:00:00.000Z"),
        documentId: "doc-1",
      });

      const res = await handleBlogEntryGetPublishedBySlug({ slug: "s" }, ctx);
      expect(res.entry.slug).toBe("s");
    });
  });

  describe("handleBlogEntryListAdmin", () => {
    it("passes status=undefined when payload.status is all", async () => {
      findContentTypeByTemplateKey.mockResolvedValueOnce({ id: "ct-1" });
      listAdminEntries.mockResolvedValueOnce([]);

      await handleBlogEntryListAdmin({ status: "all", limit: 20, offset: 0 }, ctx);

      const arg = listAdminEntries.mock.calls[0]?.[0] as any;
      expect(arg.status).toBeUndefined();
    });

    it("maps admin entries and defaults non-string slug/title to empty strings", async () => {
      findContentTypeByTemplateKey.mockResolvedValueOnce({ id: "ct-1" });
      listAdminEntries.mockResolvedValueOnce([
        {
          id: "e-1",
          status: "draft",
          publishedAt: null,
          updatedAt: new Date("2024-01-01T00:00:00.000Z"),
          documentId: null,
          data: { slug: "s", title: "t" },
        },
        {
          id: "e-2",
          status: "draft",
          publishedAt: null,
          updatedAt: new Date("2024-01-02T00:00:00.000Z"),
          documentId: null,
          data: { slug: 123, title: "" },
        },
      ]);

      const res = await handleBlogEntryListAdmin(
        { status: "all", limit: 20, offset: 0 },
        ctx,
      );

      expect(res.items[0]?.slug).toBe("s");
      expect(res.items[1]?.slug).toBe("");
      expect(res.items[1]?.title).toBe("");
    });
  });
});

describe("handleBlogEntryUpdateMeta (Unit)", () => {
  const ctx: ActionContext = { workspaceId: "ws-1", userId: "user-1" };

  it("throws EntryNotFoundError when entry is missing", async () => {
    findEntryByIdAndWorkspace.mockResolvedValueOnce(null);

    await expect(
      handleBlogEntryUpdateMeta(
        {
          id: "550e8400-e29b-41d4-a716-446655440000",
          publishNow: true,
        },
        ctx,
      ),
    ).rejects.toBeInstanceOf(EntryNotFoundError);
  });

  it("throws EntryNotFoundError when templateKey is not blog_post", async () => {
    findEntryByIdAndWorkspace.mockResolvedValueOnce({
      id: "e-1",
      contentTypeId: "ct-1",
      data: {},
      status: "draft",
      publishedAt: null,
    });
    findContentTypeByIdAndWorkspace.mockResolvedValueOnce({
      id: "ct-1",
      templateKey: "other_template",
    });

    await expect(
      handleBlogEntryUpdateMeta(
        {
          id: "550e8400-e29b-41d4-a716-446655440000",
          publishNow: true,
        },
        ctx,
      ),
    ).rejects.toBeInstanceOf(EntryNotFoundError);
  });

  it("updates publish state without sending data when payload.data is undefined", async () => {
    findEntryByIdAndWorkspace.mockResolvedValueOnce({
      id: "e-1",
      contentTypeId: "ct-1",
      data: { slug: "s", title: "t" },
      status: "draft",
      publishedAt: null,
    });
    findContentTypeByIdAndWorkspace.mockResolvedValueOnce({
      id: "ct-1",
      templateKey: "blog_post",
    });
    updateEntryByIdAndWorkspace.mockResolvedValueOnce({
      id: "e-1",
      contentTypeId: "ct-1",
      data: { slug: "s", title: "t" },
      status: "published",
      publishedAt: new Date(),
    });

    const res = await handleBlogEntryUpdateMeta(
      {
        id: "550e8400-e29b-41d4-a716-446655440000",
        publishNow: true,
      },
      ctx,
    );

    expect(res.success).toBe(true);
    const arg = updateEntryByIdAndWorkspace.mock.calls[0]?.[0] as any;
    expect(arg.entryId).toBe("e-1");
    expect("data" in arg).toBe(false);
    expect(arg.status).toBe("published");
    expect(arg.updatedBy).toBe("user-1");
  });
});

describe("applyBlogEntryMetaUpdate (extra cases)", () => {
  it("treats stringified object data as JSON when possible", () => {
    const current = {
      data: "{\"slug\":\"s\",\"title\":\"t\"}",
      status: "draft" as const,
      publishedAt: null,
    };

    const next = applyBlogEntryMetaUpdate(current, { data: { title: "new" } });
    expect(next.data.slug).toBe("s");
    expect(next.data.title).toBe("new");
  });

  it("ignores unparsable JSON strings and uses an empty object", () => {
    const current = {
      data: "{not-json",
      status: "draft" as const,
      publishedAt: null,
    };

    const next = applyBlogEntryMetaUpdate(current, { data: { title: "new" } });
    expect(next.data.title).toBe("new");
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
