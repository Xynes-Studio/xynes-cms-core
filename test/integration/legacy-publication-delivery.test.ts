import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { app } from "../../src/index";
import { db } from "../../src/infra/db";
import {
  createEntry,
  listPublishedEntries,
  findPublishedEntryBySlug,
  publishEntryByIdAndWorkspace,
  updateEntryByIdAndWorkspaceScoped,
} from "../../src/infra/db/repositories/content-entry.repository";
import { contentEntries, contentTypes } from "../../src/infra/db/schema";
import { runSeed } from "../../src/infra/db/seeders";
import { INTERNAL_SERVICE_TOKEN } from "../support/internal-auth";

const publicEnvelope = z.object({
  ok: z.literal(true),
  data: z.object({
    entry: z.record(z.string(), z.unknown()).optional(),
    entries: z.array(z.record(z.string(), z.unknown())).optional(),
  }),
});
describe.skipIf(process.env.RUN_INTEGRATION_TESTS !== "true")(
  "legacy publication reads (isolated PostgreSQL)",
  () => {
    const workspaceId = crypto.randomUUID();
    let contentTypeId: string;
    beforeAll(async () => {
      await runSeed(db, workspaceId);
      const [type] = await db
        .select()
        .from(contentTypes)
        .where(eq(contentTypes.workspaceId, workspaceId));
      contentTypeId = type.id;
    });
    afterAll(async () => {
      await db
        .delete(contentEntries)
        .where(eq(contentEntries.workspaceId, workspaceId));
      await db
        .delete(contentTypes)
        .where(eq(contentTypes.workspaceId, workspaceId));
    });
    async function request(
      actionKey: string,
      payload: Record<string, unknown>,
      scopedWorkspace = workspaceId,
    ) {
      return app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
          "X-Workspace-Id": scopedWorkspace,
        },
        body: JSON.stringify({ actionKey, payload }),
      });
    }
    it("frozen slug, tag, title, cover and body survive saves and change only on republish", async () => {
      const entry = await createEntry({
        workspaceId,
        contentTypeId,
        status: "published",
        data: {
          slug: "published-slug",
          title: "Published A",
          tags: ["alpha"],
          coverImageUrl: "https://example.invalid/cover?w=120",
          body: { root: { type: "root", version: 1, children: [] } },
        },
      });
      await updateEntryByIdAndWorkspaceScoped({
        entryId: entry.id,
        workspaceId,
        data: {
          slug: "draft-slug",
          title: "Draft B",
          tags: ["beta"],
          coverImageUrl: "https://example.invalid/cover?access_token=fixture",
          body: { privateNode: "fixture" },
          privateNote: "fixture",
        },
      });
      for (const family of ["cms.content", "cms.blog_entry"]) {
        const detail = await request(`${family}.getPublishedBySlug`, {
          slug: "published-slug",
          ...(family === "cms.content" ? { routeSegment: "blog" } : {}),
        });
        expect(detail.status).toBe(200);
        const result = publicEnvelope.parse(await detail.json());
        expect(result.data.entry).toMatchObject({
          slug: "published-slug",
          title: "Published A",
          tags: ["alpha"],
          coverImageUrl: "https://example.invalid/cover?w=120",
        });
        expect(JSON.stringify(result)).not.toMatch(
          /Draft B|access_token|privateNode|privateNote|draft-slug/,
        );
        const list = await request(`${family}.listPublished`, {
          tag: "alpha",
          ...(family === "cms.content" ? { routeSegment: "blog" } : {}),
        });
        expect(list.status).toBe(200);
        expect(
          publicEnvelope.parse(await list.json()).data.entries,
        ).toHaveLength(1);
        const newSlug = await request(`${family}.getPublishedBySlug`, {
          slug: "draft-slug",
          ...(family === "cms.content" ? { routeSegment: "blog" } : {}),
        });
        expect(newSlug.status).toBe(404);
      }
      await expect(
        publishEntryByIdAndWorkspace({ entryId: entry.id, workspaceId }),
      ).rejects.toHaveProperty("code", "PUBLICATION_INVALID");
      await updateEntryByIdAndWorkspaceScoped({
        entryId: entry.id,
        workspaceId,
        data: {
          slug: "republished-slug",
          title: "Published B",
          tags: ["beta"],
        },
      });
      await publishEntryByIdAndWorkspace({ entryId: entry.id, workspaceId });
      expect(
        (
          await request("cms.content.getPublishedBySlug", {
            routeSegment: "blog",
            slug: "published-slug",
          })
        ).status,
      ).toBe(404);
      const republished = await request("cms.content.getPublishedBySlug", {
        routeSegment: "blog",
        slug: "republished-slug",
      });
      expect(republished.status).toBe(200);
      expect(
        publicEnvelope.parse(await republished.json()).data.entry,
      ).toHaveProperty("title", "Published B");
    });
    it("malformed or historical snapshots are unavailable without a draft fallback", async () => {
      const entry = await createEntry({
        workspaceId,
        contentTypeId,
        status: "published",
        data: { slug: "historical", title: "Historical" },
      });
      await db
        .update(contentEntries)
        .set({ publishedSnapshot: null })
        .where(eq(contentEntries.id, entry.id));
      expect(
        (
          await request("cms.content.getPublishedBySlug", {
            routeSegment: "blog",
            slug: "historical",
          })
        ).status,
      ).toBe(404);
      const foreign = await request(
        "cms.content.getPublishedBySlug",
        { routeSegment: "blog", slug: "historical" },
        crypto.randomUUID(),
      );
      expect(foreign.status).toBe(404);
    });
    it("keeps harmless large editor bodies out of both legacy list paths but preserves detail", async () => {
      const text = "summary-must-not-return ".repeat(2000);
      const body = {
        root: {
          type: "root",
          version: 1,
          children: [
            {
              type: "paragraph",
              version: 1,
              children: [{ type: "text", version: 1, text }],
            },
          ],
        },
      };
      const entry = await createEntry({
        workspaceId,
        contentTypeId,
        status: "published",
        data: {
          slug: "bounded-summary",
          title: "Bounded summary",
          tags: ["bounded"],
          body,
        },
      });
      const changed = await createEntry({
        workspaceId,
        contentTypeId,
        status: "published",
        data: {
          slug: "changed-body",
          title: "Changed body",
          tags: ["bounded"],
          body,
        },
      });
      await db
        .update(contentEntries)
        .set({
          publishedSnapshot: sql`jsonb_set(${contentEntries.publishedSnapshot}, '{entry,body}', '{"private":"changed"}'::jsonb)`,
        })
        .where(eq(contentEntries.id, changed.id));
      const rows = await listPublishedEntries(
        workspaceId,
        contentTypeId,
        100,
        0,
        "bounded",
      );
      expect(rows.map((row) => row.id)).toEqual([entry.id]);
      expect(
        z
          .object({ entry: z.object({ body: z.null() }) })
          .parse(rows[0].publishedSnapshot).entry.body,
      ).toBeNull();
      expect(JSON.stringify(rows).length).toBeLessThan(5000);
      expect(JSON.stringify(rows)).not.toContain("summary-must-not-return");
      const detail = await findPublishedEntryBySlug(
        workspaceId,
        contentTypeId,
        "bounded-summary",
      );
      expect(
        z
          .object({ entry: z.object({ body: z.unknown() }) })
          .parse(detail?.publishedSnapshot).entry.body,
      ).toEqual(body);
      for (const family of ["cms.content", "cms.blog_entry"]) {
        const response = await request(`${family}.listPublished`, {
          limit: 100,
          tag: "bounded",
          ...(family === "cms.content" ? { routeSegment: "blog" } : {}),
        });
        expect(response.status).toBe(200);
        const result = publicEnvelope.parse(await response.json());
        expect(result.data.entries).toEqual([
          expect.objectContaining({
            id: entry.id,
            slug: "bounded-summary",
            title: "Bounded summary",
          }),
        ]);
        expect(JSON.stringify(result)).not.toMatch(
          /summary-must-not-return|changed-body|publishedSnapshot/,
        );
      }
    });
    it("captures the document reference at create-with-publish instead of reading a mutable row", async () => {
      const documentId = crypto.randomUUID();
      await createEntry({
        workspaceId,
        contentTypeId,
        documentId,
        status: "published",
        data: { slug: "document-reference", title: "Document reference" },
      });
      const response = await request("cms.content.getPublishedBySlug", {
        routeSegment: "blog",
        slug: "document-reference",
      });
      expect(response.status).toBe(200);
      expect(
        publicEnvelope.parse(await response.json()).data.entry,
      ).toHaveProperty("documentId", documentId);
    });
  },
);
