import { describe, expect, it } from "bun:test";
import {
  createHandleBlogEntryGetPublishedBySlug,
  createHandleBlogEntryListPublished,
} from "../../src/actions/handlers/blog-entry.handler";
import {
  type ContentPublishedHandlerDeps,
  createHandleContentGetPublishedBySlug,
  createHandleContentListPublished,
} from "../../src/actions/handlers/content-published.handler";
import { buildPublicationSnapshot } from "../../src/actions/publication-snapshot";
import { legacyPublicationFixture } from "../support/legacy-publication-fixture";

const published = legacyPublicationFixture();
const type = {
  id: published.contentTypeId,
  workspaceId: published.workspaceId,
  templateKey: "blog_post",
  name: "Blog",
  slug: "blog",
  routeSegment: "blog",
  config: null,
};
function dependencies(entry = published): ContentPublishedHandlerDeps {
  return {
    findContentTypeByRouteSegmentAndWorkspace: async () => type,
    listPublishedEntries: async () => [entry],
    findPublishedEntryBySlug: async () => entry,
  };
}
const ctx = { workspaceId: published.workspaceId };

describe("legacy delivery publication boundary", () => {
  it("generic detail and list serve only frozen values after an authenticated draft edit", async () => {
    const deps = dependencies(
      legacyPublicationFixture({
        data: {
          slug: "edited-slug",
          title: "Private draft",
          tags: ["draft"],
          coverImageUrl: "https://example.invalid/?access_token=fixture",
          body: { privateNode: "fixture" },
          rawKey: "private",
        },
        documentId: published.id,
      }),
    );
    const detail = await createHandleContentGetPublishedBySlug(deps)(
      { routeSegment: "blog", slug: "s" },
      ctx,
    );
    expect(detail.entry).toMatchObject({
      id: published.id,
      slug: "s",
      title: "Published",
      tags: ["published"],
      coverImageUrl: "https://example.invalid/cover",
      documentId: null,
    });
    expect(detail.entry.data).toEqual({
      slug: "s",
      title: "Published",
      description: "Published excerpt",
      excerpt: "Published excerpt",
      tags: ["published"],
      coverImageUrl: "https://example.invalid/cover",
      body: { root: { type: "root", version: 1, children: [] } },
    });
    const list = await createHandleContentListPublished(deps)(
      { routeSegment: "blog", limit: 10, offset: 0 },
      ctx,
    );
    expect(list.entries[0]).toEqual({
      id: published.id,
      slug: "s",
      title: "Published",
      excerpt: "Published excerpt",
      tags: ["published"],
      coverImageUrl: "https://example.invalid/cover",
      documentId: null,
      publishedAt: published.publishedAt,
    });
    expect(JSON.stringify({ detail, list })).not.toMatch(
      /Private draft|access_token|privateNode|rawKey|edited-slug/,
    );
  });
  it("blog detail and list reuse the same frozen mapper", async () => {
    const deps = {
      ...dependencies(
        legacyPublicationFixture({ data: { slug: "s", title: "private" } }),
      ),
      findContentTypeByTemplateKey: async () => type,
    };
    const detail = await createHandleBlogEntryGetPublishedBySlug(deps)(
      { slug: "s" },
      ctx,
    );
    const list = await createHandleBlogEntryListPublished(deps)(
      { limit: 10, offset: 0 },
      ctx,
    );
    expect(detail.entry.title).toBe("Published");
    expect(list.entries[0]).toEqual(detail.entry);
  });
  it("never falls back for missing, malformed, mismatched, future or hidden publications", async () => {
    const snapshot = buildPublicationSnapshot(
      published,
      published.publishedAt ?? new Date(),
    );
    for (const patch of [
      { publishedSnapshot: null },
      { publishedSnapshot: { bad: "fixture" } },
      { id: type.id },
      { publishedAt: new Date("2099-01-01") },
      { status: "draft" },
      { status: "archived" },
      { deletedAt: new Date() },
      { publishedSnapshot: { ...snapshot, legacy: undefined } },
      {
        publishedSnapshot: {
          ...snapshot,
          entry: {
            ...snapshot.entry,
            body: {
              root: {
                type: "root",
                version: 1,
                children: [{ type: "private-unknown", version: 1 }],
              },
            },
          },
        },
      },
      {
        publishedSnapshot: {
          ...snapshot,
          legacy: {
            slug: "s",
            documentId: null,
            coverImageUrl: "https://example.invalid/?api_key=fixture",
          },
        },
      },
    ]) {
      const deps = dependencies(legacyPublicationFixture(patch));
      await expect(
        createHandleContentGetPublishedBySlug(deps)(
          { routeSegment: "blog", slug: "s" },
          ctx,
        ),
      ).rejects.toHaveProperty("code", "ENTRY_NOT_FOUND");
      expect(
        await createHandleContentListPublished(deps)(
          { routeSegment: "blog", limit: 10, offset: 0 },
          ctx,
        ),
      ).toEqual({ entries: [] });
    }
  });
  it("does not return another published slug when a repository result is inconsistent", async () => {
    await expect(
      createHandleContentGetPublishedBySlug(dependencies())(
        { routeSegment: "blog", slug: "other" },
        ctx,
      ),
    ).rejects.toHaveProperty("code", "ENTRY_NOT_FOUND");
  });
});
