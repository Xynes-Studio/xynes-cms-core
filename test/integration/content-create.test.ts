import { describe, it, expect, beforeAll } from "bun:test";
import { app } from "../../src/index";
import { db } from "../../src/infra/db";
import {
  contentEntries,
  contentTypes,
  globalContentTemplates,
} from "../../src/infra/db/schema";
import { eq, and } from "drizzle-orm";
import { INTERNAL_SERVICE_TOKEN } from "../support/internal-auth";

describe.skipIf(process.env.RUN_INTEGRATION_TESTS !== "true")(
  "Content Create Action Integration",
  () => {
    let testWorkspaceId: string;
    let otherWorkspaceId: string;
    let contentTypeId: string;
    let templateKey: string;

    beforeAll(async () => {
      testWorkspaceId = crypto.randomUUID();
      otherWorkspaceId = crypto.randomUUID();
      templateKey = `test_template_${crypto.randomUUID()}`;

      await db.insert(globalContentTemplates).values({
        key: templateKey,
        fieldsSchema: {
          slug: { type: "string", required: true },
          title: { type: "string", required: true },
        },
        description: "Test template for cms.content.create",
      });

      const [contentType] = await db
        .insert(contentTypes)
        .values({
          workspaceId: testWorkspaceId,
          templateKey,
          name: "Blog",
          slug: "blog",
          routeSegment: "blog",
          config: {},
        })
        .returning();

      contentTypeId = contentType.id;
    });

    it("creates a blog entry via cms.content.create", async () => {
      const slug = `generic-${crypto.randomUUID()}`;

      const res = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
          "X-Workspace-Id": testWorkspaceId,
          "X-XS-User-Id": "test-user",
        },
        body: JSON.stringify({
          actionKey: "cms.content.create",
          payload: {
            contentTypeId,
            publishNow: false,
            documentId: null,
            data: {
              slug,
              title: "Generic Create",
              excerpt: "extra field allowed",
            },
          },
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.ok).toBe(true);
      expect(body.data.entry.contentTypeId).toBe(contentTypeId);
      expect(body.data.entry.routeSegment).toBe("blog");
      expect(body.data.entry.slug).toBe(slug);

      const created = await db.query.contentEntries.findFirst({
        where: and(
          eq(contentEntries.workspaceId, testWorkspaceId),
          eq(contentEntries.contentTypeId, contentTypeId),
        ),
        orderBy: (t, { desc }) => [desc(t.createdAt)],
      });

      expect(created).toBeTruthy();
      expect((created as any).data.slug).toBe(slug);
      expect((created as any).data.title).toBe("Generic Create");
      expect((created as any).status).toBe("draft");
      expect((created as any).publishedAt).toBeNull();
    });

    it("creates rows compatible with cms.blog_entry.create", async () => {
      const genericSlug = `generic-${crypto.randomUUID()}`;
      const blogSlug = `blog-${crypto.randomUUID()}`;

      const genericRes = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
          "X-Workspace-Id": testWorkspaceId,
        },
        body: JSON.stringify({
          actionKey: "cms.content.create",
          payload: {
            contentTypeId,
            data: { slug: genericSlug, title: "Generic" },
          },
        }),
      });
      expect(genericRes.status).toBe(200);

      const blogRes = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
          "X-Workspace-Id": testWorkspaceId,
        },
        body: JSON.stringify({
          actionKey: "cms.blog_entry.create",
          payload: {
            contentTypeId,
            data: { slug: blogSlug, title: "Blog" },
          },
        }),
      });
      expect(blogRes.status).toBe(200);

      const rows = await db
        .select()
        .from(contentEntries)
        .where(
          and(
            eq(contentEntries.workspaceId, testWorkspaceId),
            eq(contentEntries.contentTypeId, contentTypeId),
          ),
        );

      const genericRow = rows.find((r: any) => (r.data as any).slug === genericSlug);
      const blogRow = rows.find((r: any) => (r.data as any).slug === blogSlug);

      expect(genericRow).toBeTruthy();
      expect(blogRow).toBeTruthy();
      expect((genericRow as any).status).toBe("draft");
      expect((blogRow as any).status).toBe("draft");
      expect((genericRow as any).publishedAt).toBeNull();
      expect((blogRow as any).publishedAt).toBeNull();
    });

    it("returns 404 for contentTypeId not in workspace", async () => {
      const res = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
          "X-Workspace-Id": otherWorkspaceId,
        },
        body: JSON.stringify({
          actionKey: "cms.content.create",
          payload: {
            contentTypeId,
            data: { slug: "nope", title: "Nope" },
          },
        }),
      });

      expect(res.status).toBe(404);
      const body = (await res.json()) as any;
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe("CONTENT_TYPE_NOT_FOUND");
    });
  },
);

