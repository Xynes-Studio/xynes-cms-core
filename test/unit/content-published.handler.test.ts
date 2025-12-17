import { describe, it, expect, beforeEach, vi } from "bun:test";
import type { ActionContext } from "../../src/actions/types";
import {
  ContentTypeRouteSegmentNotFoundError,
  EntryNotFoundError,
} from "../../src/actions/errors";
import {
  ContentGetPublishedBySlugPayloadSchema,
  ContentListPublishedPayloadSchema,
  createHandleContentGetPublishedBySlug,
  createHandleContentListPublished,
} from "../../src/actions/handlers/content-published.handler";

const findContentTypeByRouteSegmentAndWorkspace = vi.fn();
const listPublishedEntries = vi.fn();
const findPublishedEntryBySlug = vi.fn();

const deps = {
  findContentTypeByRouteSegmentAndWorkspace,
  listPublishedEntries,
  findPublishedEntryBySlug,
};

const handleListPublished = createHandleContentListPublished(deps as any);
const handleGetBySlug = createHandleContentGetPublishedBySlug(deps as any);

const ctx: ActionContext = { workspaceId: "ws-1", userId: "user-1" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Content Published Schemas", () => {
  describe("ContentListPublishedPayloadSchema", () => {
    it("requires routeSegment and applies defaults", () => {
      const result = ContentListPublishedPayloadSchema.safeParse({
        routeSegment: "blog",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.limit).toBe(10);
        expect(result.data.offset).toBe(0);
      }
    });

    it("rejects invalid routeSegment", () => {
      const result = ContentListPublishedPayloadSchema.safeParse({
        routeSegment: "blog/../../x",
      });
      expect(result.success).toBe(false);
    });

    it("is strict (rejects unknown keys)", () => {
      const result = ContentListPublishedPayloadSchema.safeParse({
        routeSegment: "blog",
        extra: "nope",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("ContentGetPublishedBySlugPayloadSchema", () => {
    it("requires routeSegment and slug", () => {
      const result = ContentGetPublishedBySlugPayloadSchema.safeParse({
        routeSegment: "blog",
        slug: "hello-world",
      });
      expect(result.success).toBe(true);
    });

    it("is strict (rejects unknown keys)", () => {
      const result = ContentGetPublishedBySlugPayloadSchema.safeParse({
        routeSegment: "blog",
        slug: "hello-world",
        extra: "nope",
      });
      expect(result.success).toBe(false);
    });
  });
});

describe("Content Published Handlers", () => {
  describe("cms.content.listPublished", () => {
    it("returns published list DTOs for routeSegment", async () => {
      findContentTypeByRouteSegmentAndWorkspace.mockResolvedValue({
        id: "ct-1",
        routeSegment: "blog",
      });

      listPublishedEntries.mockResolvedValue([
        {
          id: "e-1",
          data: {
            slug: "s1",
            title: "t1",
            excerpt: "ex1",
            tags: ["news"],
            coverImageUrl: "https://example.com/img.jpg",
          },
          publishedAt: new Date("2024-01-01T00:00:00.000Z"),
          documentId: null,
        },
      ]);

      const result = await handleListPublished(
        { routeSegment: "blog", limit: 10, offset: 0, tag: "news" },
        ctx,
      );

      expect(findContentTypeByRouteSegmentAndWorkspace).toHaveBeenCalledWith(
        "blog",
        "ws-1",
      );
      expect(listPublishedEntries).toHaveBeenCalledWith(
        "ws-1",
        "ct-1",
        10,
        0,
        "news",
      );
      expect(result.entries).toEqual([
        {
          id: "e-1",
          slug: "s1",
          title: "t1",
          excerpt: "ex1",
          tags: ["news"],
          coverImageUrl: "https://example.com/img.jpg",
          publishedAt: new Date("2024-01-01T00:00:00.000Z"),
          documentId: null,
        },
      ]);
    });

    it("throws NOT_FOUND for invalid routeSegment in workspace", async () => {
      findContentTypeByRouteSegmentAndWorkspace.mockResolvedValue(null);

      await expect(
        handleListPublished({ routeSegment: "missing" }, ctx),
      ).rejects.toBeInstanceOf(ContentTypeRouteSegmentNotFoundError);
    });
  });

  describe("cms.content.getPublishedBySlug", () => {
    it("returns full DTO (including data)", async () => {
      findContentTypeByRouteSegmentAndWorkspace.mockResolvedValue({
        id: "ct-1",
        routeSegment: "blog",
      });

      findPublishedEntryBySlug.mockResolvedValue({
        id: "e-1",
        data: { slug: "s1", title: "t1", extra: { blocks: [] } },
        publishedAt: new Date("2024-01-01T00:00:00.000Z"),
        documentId: "doc-1",
      });

      const result = await handleGetBySlug(
        { routeSegment: "blog", slug: "s1" },
        ctx,
      );

      expect(findPublishedEntryBySlug).toHaveBeenCalledWith(
        "ws-1",
        "ct-1",
        "s1",
      );
      expect(result.entry.id).toBe("e-1");
      expect(result.entry.slug).toBe("s1");
      expect(result.entry.data).toEqual({
        slug: "s1",
        title: "t1",
        extra: { blocks: [] },
      });
    });

    it("throws ENTRY_NOT_FOUND when slug does not exist", async () => {
      findContentTypeByRouteSegmentAndWorkspace.mockResolvedValue({
        id: "ct-1",
        routeSegment: "blog",
      });
      findPublishedEntryBySlug.mockResolvedValue(null);

      await expect(
        handleGetBySlug({ routeSegment: "blog", slug: "missing" }, ctx),
      ).rejects.toBeInstanceOf(EntryNotFoundError);
    });
  });
});

