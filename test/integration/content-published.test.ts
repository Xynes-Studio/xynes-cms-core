import { describe, it, expect, beforeAll } from "bun:test";
import { and, eq } from "drizzle-orm";
import { app } from "../../src/index";
import { db } from "../../src/infra/db";
import { contentTypes } from "../../src/infra/db/schema";
import { runSeed } from "../../src/infra/db/seeders";
import { INTERNAL_SERVICE_TOKEN } from "../support/internal-auth";

describe.skipIf(process.env.RUN_INTEGRATION_TESTS !== "true")(
  "Generic Published Content Actions Integration",
  () => {
    const routeSegment = "blog";
    let workspaceId: string;
    let otherWorkspaceId: string;
    let blogContentTypeId: string;
    let otherBlogContentTypeId: string;

    beforeAll(async () => {
      workspaceId = crypto.randomUUID();
      otherWorkspaceId = crypto.randomUUID();

      await runSeed(db, workspaceId);
      await runSeed(db, otherWorkspaceId);

      const [ct] = await db
        .select()
        .from(contentTypes)
        .where(
          and(
            eq(contentTypes.workspaceId, workspaceId),
            eq(contentTypes.routeSegment, routeSegment),
          ),
        )
        .limit(1);
      if (!ct) throw new Error("Seeded blog content type not found");
      blogContentTypeId = ct.id;

      const [otherCt] = await db
        .select()
        .from(contentTypes)
        .where(
          and(
            eq(contentTypes.workspaceId, otherWorkspaceId),
            eq(contentTypes.routeSegment, routeSegment),
          ),
        )
        .limit(1);
      if (!otherCt) throw new Error("Seeded other blog content type not found");
      otherBlogContentTypeId = otherCt.id;
    });

    it("cms.content.listPublished lists only published entries for routeSegment", async () => {
      const uniq = `lp-${crypto.randomUUID()}`;
      const publishedSlug = `${uniq}-pub`;
      const draftSlug = `${uniq}-draft`;

      await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
          "X-Workspace-Id": workspaceId,
        },
        body: JSON.stringify({
          actionKey: "cms.content.create",
          payload: {
            contentTypeId: blogContentTypeId,
            publishNow: true,
            data: {
              slug: publishedSlug,
              title: "Published",
              excerpt: "p",
              tags: ["news"],
              coverImageUrl: "https://example.com/cover.jpg",
            },
          },
        }),
      });

      await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
          "X-Workspace-Id": workspaceId,
        },
        body: JSON.stringify({
          actionKey: "cms.content.create",
          payload: {
            contentTypeId: blogContentTypeId,
            data: { slug: draftSlug, title: "Draft" },
          },
        }),
      });

      const res = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
          "X-Workspace-Id": workspaceId,
        },
        body: JSON.stringify({
          actionKey: "cms.content.listPublished",
          payload: { routeSegment, limit: 10, offset: 0 },
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.ok).toBe(true);

      const slugs = (body.data.entries as any[]).map((e) => e.slug);
      expect(slugs).toContain(publishedSlug);
      expect(slugs).not.toContain(draftSlug);
    }, 15000);

    it("cms.content.listPublished filters by tag", async () => {
      const uniq = `tag-${crypto.randomUUID()}`;
      const newsSlug = `${uniq}-news`;
      const otherSlug = `${uniq}-other`;

      await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
          "X-Workspace-Id": workspaceId,
        },
        body: JSON.stringify({
          actionKey: "cms.content.create",
          payload: {
            contentTypeId: blogContentTypeId,
            publishNow: true,
            data: { slug: newsSlug, title: "News", tags: ["news"] },
          },
        }),
      });

      await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
          "X-Workspace-Id": workspaceId,
        },
        body: JSON.stringify({
          actionKey: "cms.content.create",
          payload: {
            contentTypeId: blogContentTypeId,
            publishNow: true,
            data: { slug: otherSlug, title: "Other", tags: ["other"] },
          },
        }),
      });

      const res = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
          "X-Workspace-Id": workspaceId,
        },
        body: JSON.stringify({
          actionKey: "cms.content.listPublished",
          payload: { routeSegment, tag: "news" },
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      const slugs = (body.data.entries as any[]).map((e) => e.slug);
      expect(slugs).toContain(newsSlug);
      expect(slugs).not.toContain(otherSlug);
    });

    it("cms.content.getPublishedBySlug returns full DTO (including data)", async () => {
      const uniq = `get-${crypto.randomUUID()}`;
      const slug = `${uniq}-pub`;

      await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
          "X-Workspace-Id": workspaceId,
        },
        body: JSON.stringify({
          actionKey: "cms.content.create",
          payload: {
            contentTypeId: blogContentTypeId,
            publishNow: true,
            data: {
              slug,
              title: "Full DTO",
              tags: ["t1"],
              blocks: [{ type: "p", text: "hello" }],
            },
          },
        }),
      });

      const res = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
          "X-Workspace-Id": workspaceId,
        },
        body: JSON.stringify({
          actionKey: "cms.content.getPublishedBySlug",
          payload: { routeSegment, slug },
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.ok).toBe(true);
      expect(body.data.entry.slug).toBe(slug);
      expect(body.data.entry.data).toMatchObject({
        slug,
        title: "Full DTO",
        tags: ["t1"],
      });
    });

    it("returns 404 for invalid routeSegment (no tenant leak)", async () => {
      const res = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
          "X-Workspace-Id": workspaceId,
        },
        body: JSON.stringify({
          actionKey: "cms.content.listPublished",
          payload: { routeSegment: "not-a-type" },
        }),
      });

      expect(res.status).toBe(404);
      const body = (await res.json()) as any;
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe("CONTENT_TYPE_ROUTE_SEGMENT_NOT_FOUND");
    });

    it("returns 404 for missing slug", async () => {
      const res = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
          "X-Workspace-Id": workspaceId,
        },
        body: JSON.stringify({
          actionKey: "cms.content.getPublishedBySlug",
          payload: { routeSegment, slug: "nope-nope-nope" },
        }),
      });

      expect(res.status).toBe(404);
      const body = (await res.json()) as any;
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe("ENTRY_NOT_FOUND");
    });

    it("is workspace-scoped (does not return other tenant entries)", async () => {
      const uniq = `iso-${crypto.randomUUID()}`;
      const otherTenantSlug = `${uniq}-other`;

      await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
          "X-Workspace-Id": otherWorkspaceId,
        },
        body: JSON.stringify({
          actionKey: "cms.content.create",
          payload: {
            contentTypeId: otherBlogContentTypeId,
            publishNow: true,
            data: { slug: otherTenantSlug, title: "Other tenant" },
          },
        }),
      });

      const res = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
          "X-Workspace-Id": workspaceId,
        },
        body: JSON.stringify({
          actionKey: "cms.content.listPublished",
          payload: { routeSegment },
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      const slugs = (body.data.entries as any[]).map((e) => e.slug);
      expect(slugs).not.toContain(otherTenantSlug);
    });
  },
);

