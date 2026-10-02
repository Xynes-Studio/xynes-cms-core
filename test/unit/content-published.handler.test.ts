import { beforeEach, describe, expect, it, vi } from "bun:test";
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
import type { ActionContext } from "../../src/actions/types";
import { legacyPublicationFixture } from "../support/legacy-publication-fixture";

const findContentTypeByRouteSegmentAndWorkspace = vi.fn();
const listPublishedEntries = vi.fn();
const findPublishedEntryBySlug = vi.fn();

const deps = {
  findContentTypeByRouteSegmentAndWorkspace,
  listPublishedEntries,
  findPublishedEntryBySlug,
};

const handleListPublished = createHandleContentListPublished(deps);
const handleGetBySlug = createHandleContentGetPublishedBySlug(deps);

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

      listPublishedEntries.mockResolvedValue([legacyPublicationFixture()]);

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
          id: legacyPublicationFixture().id,
          slug: "s",
          title: "Published",
          excerpt: "Published excerpt",
          tags: ["published"],
          coverImageUrl: "https://example.invalid/cover",
          publishedAt: new Date("2024-01-01T00:00:00.000Z"),
          documentId: null,
        },
      ]);
    });

    it("throws NOT_FOUND for invalid routeSegment in workspace", async () => {
      findContentTypeByRouteSegmentAndWorkspace.mockResolvedValue(null);

      await expect(
        handleListPublished(
          { routeSegment: "missing", limit: 10, offset: 0 },
          ctx,
        ),
      ).rejects.toBeInstanceOf(ContentTypeRouteSegmentNotFoundError);
    });
  });

  describe("cms.content.getPublishedBySlug", () => {
    it("returns the documented DTO with validated publication data", async () => {
      findContentTypeByRouteSegmentAndWorkspace.mockResolvedValue({
        id: "ct-1",
        routeSegment: "blog",
      });

      findPublishedEntryBySlug.mockResolvedValue(legacyPublicationFixture());

      const result = await handleGetBySlug(
        { routeSegment: "blog", slug: "s" },
        ctx,
      );

      expect(findPublishedEntryBySlug).toHaveBeenCalledWith(
        "ws-1",
        "ct-1",
        "s",
      );
      expect(result.entry.id).toBe(legacyPublicationFixture().id);
      expect(result.entry.slug).toBe("s");
      expect(result.entry.data).toMatchObject({
        slug: "s",
        title: "Published",
        tags: ["published"],
      });
      expect(result.entry.data).not.toHaveProperty("extra");
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
