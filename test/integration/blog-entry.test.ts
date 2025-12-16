import { describe, it, expect, beforeAll } from "bun:test";
import { app } from "../../src/index";
import { db } from "../../src/infra/db";
import { contentTypes, contentEntries, globalContentTemplates } from "../../src/infra/db/schema";
import { eq, and } from "drizzle-orm";

describe("Blog Entry Actions Integration", () => {
  let testWorkspaceId: string;
  let otherWorkspaceId: string;
  let otherBlogPostContentTypeId: string;
  let testContentTypeId: string;
  let testTemplateKey: string;

  beforeAll(async () => {
    // Create test fixtures
    testWorkspaceId = crypto.randomUUID();
    otherWorkspaceId = crypto.randomUUID();
    testTemplateKey = `test_template_${Date.now()}`;

    // Create a template
    await db.insert(globalContentTemplates).values({
      key: testTemplateKey,
      fieldsSchema: {
        slug: { type: "string", required: true },
        title: { type: "string", required: true },
      },
      description: "Test template for blog entry tests",
    });

    // Create a content type for this workspace
    const [contentType] = await db.insert(contentTypes).values({
      workspaceId: testWorkspaceId,
      templateKey: testTemplateKey,
      name: "Test Blog",
      slug: "test-blog",
      config: {},
    }).returning();

    testContentTypeId = contentType.id;

    // Create 'blog_post' template and content type for listPublished/getPublishedBySlug tests
    const blogPostTemplateKey = "blog_post";
    // Check if it exists globally first to avoid unique key error if run repeatedly (though DB might be fresh)
    await db.insert(globalContentTemplates).values({
      key: blogPostTemplateKey,
      fieldsSchema: {
        slug: { type: "string", required: true },
        title: { type: "string", required: true },
      },
      description: "Standard Blog Post Template",
    }).onConflictDoNothing();

    await db.insert(contentTypes).values({
      workspaceId: testWorkspaceId,
      templateKey: blogPostTemplateKey,
      name: "Standard Blog",
      slug: "blog",
      config: {},
    }).returning();

    // Create a 'blog_post' content type for a different workspace (multi-tenant isolation tests)
    const [otherBlogPostContentType] = await db.insert(contentTypes).values({
      workspaceId: otherWorkspaceId,
      templateKey: blogPostTemplateKey,
      name: "Other Workspace Blog",
      slug: "blog",
      config: {},
    }).returning();
    otherBlogPostContentTypeId = otherBlogPostContentType.id;
  });

  describe("cms.blog_entry.create", () => {
    it("should create a blog entry and return 200", async () => {
      const res = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Workspace-Id": testWorkspaceId,
          "X-XS-User-Id": "test-user",
        },
        body: JSON.stringify({
          actionKey: "cms.blog_entry.create",
          payload: {
            contentTypeId: testContentTypeId,
            data: {
              slug: "my-first-post",
              title: "My First Post",
              excerpt: "This is a test post",
              tags: ["test", "integration"],
            },
          },
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.ok).toBe(true);
      expect(body.data.entry).toBeDefined();
      expect(body.data.entry.data.slug).toBe("my-first-post");
      expect(body.data.entry.data.title).toBe("My First Post");
      expect(body.data.entry.contentTypeId).toBe(testContentTypeId);
    });

    it("should create a blog entry with documentId", async () => {
      const documentId = crypto.randomUUID();
      
      const res = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Workspace-Id": testWorkspaceId,
          "X-XS-User-Id": "test-user",
        },
        body: JSON.stringify({
          actionKey: "cms.blog_entry.create",
          payload: {
            contentTypeId: testContentTypeId,
            documentId,
            data: {
              slug: "doc-backed-post",
              title: "Document Backed Post",
              excerpt: "Linked to a doc",
              tags: ["doc", "cms"],
            },
          },
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.ok).toBe(true);
      expect(body.data.entry.documentId).toBe(documentId);
      expect(body.data.entry.data.slug).toBe("doc-backed-post");
      expect(body.data.entry.status).toBe("draft");
      expect(body.data.entry.publishedAt).toBeNull();
    });

    it("should create a published blog entry with publishNow flag", async () => {
      const res = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Workspace-Id": testWorkspaceId,
          "X-XS-User-Id": "test-user",
        },
        body: JSON.stringify({
          actionKey: "cms.blog_entry.create",
          payload: {
            contentTypeId: testContentTypeId,
            publishNow: true,
            data: {
              slug: "published-post",
              title: "Published Post",
            },
          },
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.ok).toBe(true);
      expect(body.data.entry.status).toBe("published");
      expect(body.data.entry.publishedAt).toBeDefined();
      expect(new Date(body.data.entry.publishedAt).getTime()).not.toBeNaN();
    });

    it("should create a published blog entry with publishedAt date", async () => {
      const publishedDate = "2023-01-01T10:00:00.000Z";
      const res = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Workspace-Id": testWorkspaceId,
          "X-XS-User-Id": "test-user",
        },
        body: JSON.stringify({
          actionKey: "cms.blog_entry.create",
          payload: {
            contentTypeId: testContentTypeId,
            data: {
              slug: "scheduled-post",
              title: "Scheduled Post",
              publishedAt: publishedDate,
            },
          },
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.ok).toBe(true);
      expect(body.data.entry.status).toBe("published");
      expect(body.data.entry.publishedAt).toBe(publishedDate);
    });

    it("should create a published blog entry with publishNow inside data", async () => {
      const res = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Workspace-Id": testWorkspaceId,
          "X-XS-User-Id": "test-user",
        },
        body: JSON.stringify({
          actionKey: "cms.blog_entry.create",
          payload: {
            contentTypeId: testContentTypeId,
            data: {
              slug: "smoke-test-post",
              title: "Smoke Test Post",
              excerpt: "This is a smoke-test blog entry",
              tags: ["smoke", "test"],
              publishNow: true,
            },
          },
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.ok).toBe(true);
      expect(body.data.entry.status).toBe("published");
      expect(body.data.entry.publishedAt).toBeDefined();
      expect(new Date(body.data.entry.publishedAt).getTime()).not.toBeNaN();
    });

    it("should return 403 for contentTypeId not in workspace", async () => {
      const otherWorkspaceId = crypto.randomUUID();
      
      const res = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Workspace-Id": otherWorkspaceId, // Different workspace
          "X-XS-User-Id": "test-user",
        },
        body: JSON.stringify({
          actionKey: "cms.blog_entry.create",
          payload: {
            contentTypeId: testContentTypeId,
            data: {
              slug: "unauthorized-post",
              title: "Unauthorized Post",
            },
          },
        }),
      });

      expect(res.status).toBe(403);
    });

    it("should return 400 for invalid payload", async () => {
      const res = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Workspace-Id": testWorkspaceId,
          "X-XS-User-Id": "test-user",
        },
        body: JSON.stringify({
          actionKey: "cms.blog_entry.create",
          payload: {
            contentTypeId: "not-a-uuid",
            data: { slug: "test", title: "Test" },
          },
        }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe("cms.blog_entry.read", () => {
    it("should return entry by slug", async () => {
      // First create an entry
      await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Workspace-Id": testWorkspaceId,
          "X-XS-User-Id": "test-user",
        },
        body: JSON.stringify({
          actionKey: "cms.blog_entry.create",
          payload: {
            contentTypeId: testContentTypeId,
            data: {
              slug: "findable-post",
              title: "Findable Post",
            },
          },
        }),
      });

      // Now read it by slug
      const res = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Workspace-Id": testWorkspaceId,
          "X-XS-User-Id": "test-user",
        },
        body: JSON.stringify({
          actionKey: "cms.blog_entry.read",
          payload: {
            contentTypeId: testContentTypeId,
            slug: "findable-post",
          },
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.data.entry).toBeDefined();
      expect(body.data.entry.data.slug).toBe("findable-post");
    });

    it("should return 404 for non-existent slug", async () => {
      const res = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Workspace-Id": testWorkspaceId,
          "X-XS-User-Id": "test-user",
        },
        body: JSON.stringify({
          actionKey: "cms.blog_entry.read",
          payload: {
            contentTypeId: testContentTypeId,
            slug: "non-existent-post",
          },
        }),
      });

      expect(res.status).toBe(404);
    });

    it("should list all entries when no slug provided", async () => {
      const res = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Workspace-Id": testWorkspaceId,
          "X-XS-User-Id": "test-user",
        },
        body: JSON.stringify({
          actionKey: "cms.blog_entry.read",
          payload: {
            contentTypeId: testContentTypeId,
          },
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.data.entries).toBeDefined();
      expect(Array.isArray(body.data.entries)).toBe(true);
      expect(body.data.entries.length).toBeGreaterThan(0);
    });

    it("should return 403 for contentTypeId not in workspace", async () => {
      const otherWorkspaceId = crypto.randomUUID();
      
      const res = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Workspace-Id": otherWorkspaceId,
          "X-XS-User-Id": "test-user",
        },
        body: JSON.stringify({
          actionKey: "cms.blog_entry.read",
          payload: {
            contentTypeId: testContentTypeId,
          },
        }),
      });

      expect(res.status).toBe(403);
    });
  });
  describe("cms.blog_entry.listPublished", () => {
    it("should list only published entries", async () => {
      // Create a published entry for 'blog_post' template
      const blogPostContentType = await db.query.contentTypes.findFirst({
        where: and(eq(contentTypes.templateKey, "blog_post"), eq(contentTypes.workspaceId, testWorkspaceId))
      });

      if (!blogPostContentType) throw new Error("Blog post content type not found");

      // 1. Published Post
      await app.request("/internal/cms-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Workspace-Id": testWorkspaceId },
        body: JSON.stringify({
          actionKey: "cms.blog_entry.create",
          payload: {
            contentTypeId: blogPostContentType.id,
            publishNow: true,
            data: { slug: "pub-1", title: "Published 1", tags: ["news"] }
          }
        })
      });

      // 2. Draft Post
      await app.request("/internal/cms-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Workspace-Id": testWorkspaceId },
        body: JSON.stringify({
          actionKey: "cms.blog_entry.create",
          payload: {
            contentTypeId: blogPostContentType.id,
            data: { slug: "draft-1", title: "Draft 1" }
          }
        })
      });

      // List Published
      const res = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Workspace-Id": testWorkspaceId,
          "X-XS-User-Id": "test-user",
        },
        body: JSON.stringify({
          actionKey: "cms.blog_entry.listPublished",
          payload: {
            limit: 10,
          },
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.data.entries).toBeDefined();
      expect(body.data.entries.length).toBeGreaterThanOrEqual(1);
      
      const publishedSlugs = body.data.entries.map((e: any) => e.slug);
      expect(publishedSlugs).toContain("pub-1");
      expect(publishedSlugs).not.toContain("draft-1");
    }, 15000);

    it("should filter by tag (mock implementation for now)", async () => {
      const res = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Workspace-Id": testWorkspaceId,
          "X-XS-User-Id": "test-user",
        },
        body: JSON.stringify({
          actionKey: "cms.blog_entry.listPublished",
          payload: {
            tag: "news",
          },
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.data.entries.length).toBeGreaterThanOrEqual(1);
      const tags = body.data.entries[0].tags;
      expect(tags).toContain("news");
    });
  });

  describe("cms.blog_entry.getPublishedBySlug", () => {
    it("should return published entry by slug", async () => {
      const res = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Workspace-Id": testWorkspaceId,
          "X-XS-User-Id": "test-user",
        },
        body: JSON.stringify({
          actionKey: "cms.blog_entry.getPublishedBySlug",
          payload: {
            slug: "pub-1",
          },
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.data.entry).toBeDefined();
      expect(body.data.entry.slug).toBe("pub-1");
    });

    it("should return 404 for draft entry", async () => {
      const res = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Workspace-Id": testWorkspaceId,
          "X-XS-User-Id": "test-user",
        },
        body: JSON.stringify({
          actionKey: "cms.blog_entry.getPublishedBySlug",
          payload: {
            slug: "draft-1",
          },
        }),
      });

      expect(res.status).toBe(404);
    });
  });

  describe("cms.blog_entry.listAdmin", () => {
    it("should list draft + published + archived by default, scoped to workspace", async () => {
      const blogPostContentType = await db.query.contentTypes.findFirst({
        where: and(eq(contentTypes.templateKey, "blog_post"), eq(contentTypes.workspaceId, testWorkspaceId)),
      });
      if (!blogPostContentType) throw new Error("Blog post content type not found");

      const uniq = `admin-${Date.now()}`;
      const draftSlug = `${uniq}-draft`;
      const publishedSlug = `${uniq}-published`;
      const archivedSlug = `${uniq}-archived`;

      const draftRes = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Workspace-Id": testWorkspaceId },
        body: JSON.stringify({
          actionKey: "cms.blog_entry.create",
          payload: {
            contentTypeId: blogPostContentType.id,
            data: { slug: draftSlug, title: "Admin Draft" },
          },
        }),
      });
      expect(draftRes.status).toBe(200);
      const draftBody = (await draftRes.json()) as any;
      const draftId = draftBody.data.entry.id as string;

      const publishedRes = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Workspace-Id": testWorkspaceId },
        body: JSON.stringify({
          actionKey: "cms.blog_entry.create",
          payload: {
            contentTypeId: blogPostContentType.id,
            publishNow: true,
            data: { slug: publishedSlug, title: "Admin Published" },
          },
        }),
      });
      expect(publishedRes.status).toBe(200);
      const publishedBody = (await publishedRes.json()) as any;
      const publishedId = publishedBody.data.entry.id as string;

      const [archived] = await db.insert(contentEntries).values({
        workspaceId: testWorkspaceId,
        contentTypeId: blogPostContentType.id,
        documentId: null,
        data: { slug: archivedSlug, title: "Admin Archived", tags: ["t1"] },
        status: "archived",
        publishedAt: new Date("2024-01-01T00:00:00.000Z"),
        createdAt: new Date("2024-01-01T00:00:00.000Z"),
        updatedAt: new Date("2024-01-03T00:00:00.000Z"),
      }).returning();

      // Ensure deterministic ordering by updatedAt DESC
      await db.update(contentEntries).set({ updatedAt: new Date("2024-01-01T00:00:00.000Z") }).where(eq(contentEntries.id, draftId));
      await db.update(contentEntries).set({ updatedAt: new Date("2024-01-02T00:00:00.000Z") }).where(eq(contentEntries.id, publishedId));

      // Seed a matching entry in a different workspace; it should NOT show up
      await db.insert(contentEntries).values({
        workspaceId: otherWorkspaceId,
        contentTypeId: otherBlogPostContentTypeId,
        documentId: null,
        data: { slug: `${uniq}-other`, title: "Other Workspace" },
        status: "published",
        publishedAt: new Date("2024-01-01T00:00:00.000Z"),
      });

      const res = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Workspace-Id": testWorkspaceId },
        body: JSON.stringify({
          actionKey: "cms.blog_entry.listAdmin",
          payload: {},
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(Array.isArray(body.data.items)).toBe(true);

      const slugs = body.data.items.map((e: any) => e.slug);
      expect(slugs).toContain(draftSlug);
      expect(slugs).toContain(publishedSlug);
      expect(slugs).toContain(archivedSlug);
      expect(slugs).not.toContain(`${uniq}-other`);

      // updatedAt DESC: archived (2024-01-03) first, then published (2024-01-02), then draft (2024-01-01)
      const idxArchived = slugs.indexOf(archivedSlug);
      const idxPublished = slugs.indexOf(publishedSlug);
      const idxDraft = slugs.indexOf(draftSlug);
      expect(idxArchived).toBeLessThan(idxPublished);
      expect(idxPublished).toBeLessThan(idxDraft);

      const archivedItem = body.data.items.find((e: any) => e.slug === archivedSlug);
      expect(archivedItem.status).toBe("archived");
      expect(archivedItem.documentId).toBeNull();
      expect(archivedItem.data?.tags).toContain("t1");
      expect(archivedItem.updatedAt).toBeDefined();
    }, 15000);

    it("should filter by status and support case-insensitive search on title/slug", async () => {
      const blogPostContentType = await db.query.contentTypes.findFirst({
        where: and(eq(contentTypes.templateKey, "blog_post"), eq(contentTypes.workspaceId, testWorkspaceId)),
      });
      if (!blogPostContentType) throw new Error("Blog post content type not found");

      const uniq = `admin-search-${Date.now()}`;
      const publishedSlug = `${uniq}-published`;
      const archivedSlug = `${uniq}-archived`;
      const archivedTitle = `Admin Archived ${uniq}`;

      // Ensure there is at least one published entry to validate the status filter
      const createPublishedRes = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Workspace-Id": testWorkspaceId },
        body: JSON.stringify({
          actionKey: "cms.blog_entry.create",
          payload: {
            contentTypeId: blogPostContentType.id,
            publishNow: true,
            data: { slug: publishedSlug, title: `Admin Published ${uniq}` },
          },
        }),
      });
      expect(createPublishedRes.status).toBe(200);

      // Insert an archived entry for deterministic search assertions
      await db.insert(contentEntries).values({
        workspaceId: testWorkspaceId,
        contentTypeId: blogPostContentType.id,
        documentId: null,
        data: { slug: archivedSlug, title: archivedTitle },
        status: "archived",
        publishedAt: new Date("2024-01-01T00:00:00.000Z"),
      });

      const resPublished = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Workspace-Id": testWorkspaceId },
        body: JSON.stringify({
          actionKey: "cms.blog_entry.listAdmin",
          payload: { status: "published", limit: 100 },
        }),
      });
      expect(resPublished.status).toBe(200);
      const publishedBody = (await resPublished.json()) as any;
      const publishedSlugs = publishedBody.data.items.map((e: any) => e.slug);
      expect(publishedSlugs).toContain(publishedSlug);
      for (const item of publishedBody.data.items) {
        expect(item.status).toBe("published");
      }

      const resSearchByTitle = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Workspace-Id": testWorkspaceId },
        body: JSON.stringify({
          actionKey: "cms.blog_entry.listAdmin",
          payload: { status: "all", search: `aDmIn aRcHiVeD ${uniq}` },
        }),
      });
      expect(resSearchByTitle.status).toBe(200);
      const searchTitleBody = (await resSearchByTitle.json()) as any;
      const matchedTitle = searchTitleBody.data.items.some((e: any) => e.slug === archivedSlug);
      expect(matchedTitle).toBe(true);

      const resSearchBySlug = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Workspace-Id": testWorkspaceId },
        body: JSON.stringify({
          actionKey: "cms.blog_entry.listAdmin",
          payload: { status: "all", search: archivedSlug.slice(0, 20) },
        }),
      });
      expect(resSearchBySlug.status).toBe(200);
      const searchSlugBody = (await resSearchBySlug.json()) as any;
      const matchedSlug = searchSlugBody.data.items.some((e: any) => e.slug === archivedSlug);
      expect(matchedSlug).toBe(true);
    }, 15000);
  });
});
