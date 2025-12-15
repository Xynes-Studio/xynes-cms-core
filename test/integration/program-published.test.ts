import { describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { app } from "../../src/index";
import { db } from "../../src/infra/db";
import {
  contentEntries,
  contentTypes,
  globalContentTemplates,
} from "../../src/infra/db/schema";

describe("Program Published Actions Integration", () => {
  async function createProgramContentType(workspaceId: string) {
    await db
      .insert(globalContentTemplates)
      .values({
        key: "program",
        fieldsSchema: {
          title: { type: "string", required: true },
          slug: { type: "string", required: true },
        },
        description: "Program Template",
      })
      .onConflictDoNothing();

    const [contentType] = await db
      .insert(contentTypes)
      .values({
        workspaceId,
        templateKey: "program",
        name: "Program",
        slug: `program-${crypto.randomUUID()}`,
        config: {},
      })
      .returning();

    return contentType.id;
  }

  it("cms.program.listPublished returns only published entries for the workspace, supports tag filter", async () => {
    const workspaceA = crypto.randomUUID();
    const workspaceB = crypto.randomUUID();
    const programContentTypeA = await createProgramContentType(workspaceA);
    const programContentTypeB = await createProgramContentType(workspaceB);

    const publishedSlugA = `program-pub-${crypto.randomUUID()}`;
    const draftSlugA = `program-draft-${crypto.randomUUID()}`;
    const publishedSlugB = `program-pub-${crypto.randomUUID()}`;

    await app.request("/internal/cms-actions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Id": workspaceA,
      },
      body: JSON.stringify({
        actionKey: "cms.program.create",
        payload: {
          contentTypeId: programContentTypeA,
          publishNow: true,
          data: {
            slug: publishedSlugA,
            title: "Published A",
            tags: ["news"],
            startDate: "2024-01-01T10:00:00Z",
          },
        },
      }),
    });

    await app.request("/internal/cms-actions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Id": workspaceA,
      },
      body: JSON.stringify({
        actionKey: "cms.program.create",
        payload: {
          contentTypeId: programContentTypeA,
          data: {
            slug: draftSlugA,
            title: "Draft A",
            tags: ["news"],
          },
        },
      }),
    });

    await app.request("/internal/cms-actions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Id": workspaceB,
      },
      body: JSON.stringify({
        actionKey: "cms.program.create",
        payload: {
          contentTypeId: programContentTypeB,
          publishNow: true,
          data: {
            slug: publishedSlugB,
            title: "Published B",
            tags: ["news"],
          },
        },
      }),
    });

    const res = await app.request("/internal/cms-actions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Id": workspaceA,
      },
      body: JSON.stringify({
        actionKey: "cms.program.listPublished",
        payload: { tag: "news" },
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;

    const slugs = body.data.entries.map((e: any) => e.slug);
    expect(slugs).toContain(publishedSlugA);
    expect(slugs).not.toContain(draftSlugA);
    expect(slugs).not.toContain(publishedSlugB);
  }, 20000);

  it("cms.program.listPublished supports pagination (limit/offset) and ordering by publishedAt desc", async () => {
    const workspaceId = crypto.randomUUID();
    const programContentTypeId = await createProgramContentType(workspaceId);

    const slug1 = `program-${crypto.randomUUID()}`;
    const slug2 = `program-${crypto.randomUUID()}`;
    const slug3 = `program-${crypto.randomUUID()}`;

    const create = async (slug: string) => {
      const res = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Workspace-Id": workspaceId,
        },
        body: JSON.stringify({
          actionKey: "cms.program.create",
          payload: {
            contentTypeId: programContentTypeId,
            publishNow: true,
            data: { slug, title: slug },
          },
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      return body.data.entry.id as string;
    };

    const id1 = await create(slug1);
    const id2 = await create(slug2);
    const id3 = await create(slug3);

    await db
      .update(contentEntries)
      .set({ publishedAt: new Date("2024-01-01T00:00:00.000Z") })
      .where(eq(contentEntries.id, id1));
    await db
      .update(contentEntries)
      .set({ publishedAt: new Date("2024-01-02T00:00:00.000Z") })
      .where(eq(contentEntries.id, id2));
    await db
      .update(contentEntries)
      .set({ publishedAt: new Date("2024-01-03T00:00:00.000Z") })
      .where(eq(contentEntries.id, id3));

    const res = await app.request("/internal/cms-actions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Id": workspaceId,
      },
      body: JSON.stringify({
        actionKey: "cms.program.listPublished",
        payload: { limit: 1, offset: 1 },
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.entries).toHaveLength(1);
    expect(body.data.entries[0].slug).toBe(slug2);
  }, 20000);

  it("filters out entries scheduled for the future (publishedAt > now) for list and get", async () => {
    const workspaceId = crypto.randomUUID();
    const programContentTypeId = await createProgramContentType(workspaceId);

    const slug = `program-future-${crypto.randomUUID()}`;

    const createRes = await app.request("/internal/cms-actions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Id": workspaceId,
      },
      body: JSON.stringify({
        actionKey: "cms.program.create",
        payload: {
          contentTypeId: programContentTypeId,
          publishNow: true,
          data: { slug, title: "Future Program", tags: ["future"] },
        },
      }),
    });

    expect(createRes.status).toBe(200);
    const createdBody = (await createRes.json()) as any;
    const entryId = createdBody.data.entry.id as string;

    await db
      .update(contentEntries)
      .set({ publishedAt: new Date("2099-01-01T00:00:00.000Z") })
      .where(eq(contentEntries.id, entryId));

    const listRes = await app.request("/internal/cms-actions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Id": workspaceId,
      },
      body: JSON.stringify({
        actionKey: "cms.program.listPublished",
        payload: { tag: "future" },
      }),
    });

    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as any;
    const slugs = listBody.data.entries.map((e: any) => e.slug);
    expect(slugs).not.toContain(slug);

    const getRes = await app.request("/internal/cms-actions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Id": workspaceId,
      },
      body: JSON.stringify({
        actionKey: "cms.program.getPublishedBySlug",
        payload: { slug },
      }),
    });

    expect(getRes.status).toBe(404);
  }, 20000);

  it("cms.program.getPublishedBySlug returns 200 for published and 404 for draft", async () => {
    const workspaceId = crypto.randomUUID();
    const programContentTypeId = await createProgramContentType(workspaceId);

    const publishedSlug = `program-pub-${crypto.randomUUID()}`;
    const draftSlug = `program-draft-${crypto.randomUUID()}`;

    await app.request("/internal/cms-actions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Id": workspaceId,
      },
      body: JSON.stringify({
        actionKey: "cms.program.create",
        payload: {
          contentTypeId: programContentTypeId,
          publishNow: true,
          data: { slug: publishedSlug, title: "Published Program" },
        },
      }),
    });

    await app.request("/internal/cms-actions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Id": workspaceId,
      },
      body: JSON.stringify({
        actionKey: "cms.program.create",
        payload: {
          contentTypeId: programContentTypeId,
          data: { slug: draftSlug, title: "Draft Program" },
        },
      }),
    });

    const okRes = await app.request("/internal/cms-actions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Id": workspaceId,
      },
      body: JSON.stringify({
        actionKey: "cms.program.getPublishedBySlug",
        payload: { slug: publishedSlug },
      }),
    });
    expect(okRes.status).toBe(200);
    const okBody = (await okRes.json()) as any;
    expect(okBody.data.entry.slug).toBe(publishedSlug);

    const notFoundRes = await app.request("/internal/cms-actions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Id": workspaceId,
      },
      body: JSON.stringify({
        actionKey: "cms.program.getPublishedBySlug",
        payload: { slug: draftSlug },
      }),
    });
    expect(notFoundRes.status).toBe(404);
  }, 20000);

  it("includes program-specific fields in the response DTO data", async () => {
    const workspaceId = crypto.randomUUID();
    const programContentTypeId = await createProgramContentType(workspaceId);

    const slug = `program-fields-${crypto.randomUUID()}`;

    await app.request("/internal/cms-actions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Id": workspaceId,
      },
      body: JSON.stringify({
        actionKey: "cms.program.create",
        payload: {
          contentTypeId: programContentTypeId,
          publishNow: true,
          data: {
            slug,
            title: "With Fields",
            startDate: "2024-01-01T10:00:00Z",
            endDate: "2024-01-01T11:00:00Z",
            location: "Somewhere",
          },
        },
      }),
    });

    const res = await app.request("/internal/cms-actions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Id": workspaceId,
      },
      body: JSON.stringify({
        actionKey: "cms.program.getPublishedBySlug",
        payload: { slug },
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.entry.data).toEqual({
      startDate: "2024-01-01T10:00:00Z",
      endDate: "2024-01-01T11:00:00Z",
      location: "Somewhere",
    });
  }, 20000);
});
