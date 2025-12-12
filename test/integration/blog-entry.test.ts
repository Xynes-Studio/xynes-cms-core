import { describe, it, expect, beforeAll } from "bun:test";
import { app } from "../../src/index";
import { db } from "../../src/infra/db";
import { contentTypes, contentEntries, globalContentTemplates } from "../../src/infra/db/schema";
import { eq, and } from "drizzle-orm";

describe("Blog Entry Actions Integration", () => {
  let testWorkspaceId: string;
  let testContentTypeId: string;
  let testTemplateKey: string;

  beforeAll(async () => {
    // Create test fixtures
    testWorkspaceId = crypto.randomUUID();
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
      expect(body.success).toBe(true);
      expect(body.entry).toBeDefined();
      expect(body.entry.data.slug).toBe("my-first-post");
      expect(body.entry.data.title).toBe("My First Post");
      expect(body.entry.contentTypeId).toBe(testContentTypeId);
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
      expect(body.success).toBe(true);
      expect(body.entry.documentId).toBe(documentId);
      expect(body.entry.data.slug).toBe("doc-backed-post");
      expect(body.entry.status).toBe("draft");
      expect(body.entry.publishedAt).toBeNull();
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
      expect(body.success).toBe(true);
      expect(body.entry.status).toBe("published");
      expect(body.entry.publishedAt).toBeDefined();
      expect(new Date(body.entry.publishedAt).getTime()).not.toBeNaN();
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
      expect(body.success).toBe(true);
      expect(body.entry.status).toBe("published");
      expect(body.entry.publishedAt).toBe(publishedDate);
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
      expect(body.entry).toBeDefined();
      expect(body.entry.data.slug).toBe("findable-post");
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
      expect(body.entries).toBeDefined();
      expect(Array.isArray(body.entries)).toBe(true);
      expect(body.entries.length).toBeGreaterThan(0);
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
});
