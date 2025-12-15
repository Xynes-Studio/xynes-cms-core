import { beforeAll, describe, expect, it } from "bun:test";
import { and, eq } from "drizzle-orm";
import { app } from "../../src/index";
import { db } from "../../src/infra/db";
import {
  contentEntries,
  contentTypes,
  globalContentTemplates,
} from "../../src/infra/db/schema";

describe("Program & Event Actions Integration", () => {
  let testWorkspaceId: string;
  let programContentTypeId: string;
  let eventContentTypeId: string;

  beforeAll(async () => {
    testWorkspaceId = crypto.randomUUID();

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

    await db
      .insert(globalContentTemplates)
      .values({
        key: "event",
        fieldsSchema: {
          title: { type: "string", required: true },
          slug: { type: "string", required: true },
        },
        description: "Event Template",
      })
      .onConflictDoNothing();

    await db
      .insert(contentTypes)
      .values({
        workspaceId: testWorkspaceId,
        templateKey: "program",
        name: "Program",
        slug: `program-${Date.now()}`,
        config: {},
      })
      .returning();

    await db
      .insert(contentTypes)
      .values({
        workspaceId: testWorkspaceId,
        templateKey: "event",
        name: "Event",
        slug: `event-${Date.now()}`,
        config: {},
      })
      .returning();

    // Resolve IDs from DB to avoid relying on insert RETURNING ordering across test runner concurrency.
    const types = await db
      .select()
      .from(contentTypes)
      .where(eq(contentTypes.workspaceId, testWorkspaceId));

    const programType = types.find((t) => t.templateKey === "program");
    const eventType = types.find((t) => t.templateKey === "event");

    if (!programType || !eventType) {
      throw new Error("Failed to set up program/event content types for tests");
    }

    programContentTypeId = programType.id;
    eventContentTypeId = eventType.id;
  });

  it("cms.program.create inserts a draft program entry and returns DTO", async () => {
    const slug = `program-entry-${crypto.randomUUID()}`;

    const res = await app.request("/internal/cms-actions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Id": testWorkspaceId,
        "X-XS-User-Id": "test-user",
      },
      body: JSON.stringify({
        actionKey: "cms.program.create",
        payload: {
          contentTypeId: programContentTypeId,
          documentId: null,
          data: {
            slug,
            title: "My Program",
            excerpt: "A program excerpt",
            tags: ["program"],
            startDate: "2024-01-01T10:00:00Z",
            endDate: "2024-01-01T11:00:00Z",
            location: "Somewhere",
          },
        },
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
    expect(body.data.entry.id).toBeDefined();
    expect(body.data.entry.slug).toBe(slug);
    expect(body.data.entry.status).toBe("draft");
    expect(body.data.entry.publishedAt).toBeNull();
    expect(body.data.entry.documentId).toBeNull();
    expect(body.data.entry.data.title).toBe("My Program");

    const inserted = await db.query.contentEntries.findFirst({
      where: and(
        eq(contentEntries.id, body.data.entry.id),
        eq(contentEntries.workspaceId, testWorkspaceId),
        eq(contentEntries.contentTypeId, programContentTypeId),
      ),
    });
    expect(inserted).toBeDefined();
  });

  it("cms.event.create inserts a published event entry and returns DTO", async () => {
    const slug = `event-entry-${crypto.randomUUID()}`;

    const res = await app.request("/internal/cms-actions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Id": testWorkspaceId,
        "X-XS-User-Id": "test-user",
      },
      body: JSON.stringify({
        actionKey: "cms.event.create",
        payload: {
          contentTypeId: eventContentTypeId,
          publishNow: true,
          data: {
            slug,
            title: "My Event",
            eventDate: "2024-01-01T10:00:00Z",
          },
        },
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
    expect(body.data.entry.slug).toBe(slug);
    expect(body.data.entry.status).toBe("published");
    expect(body.data.entry.publishedAt).toBeDefined();
    expect(new Date(body.data.entry.publishedAt).getTime()).not.toBeNaN();
  });

  it("rejects program creation with an event content type", async () => {
    const res = await app.request("/internal/cms-actions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Id": testWorkspaceId,
      },
      body: JSON.stringify({
        actionKey: "cms.program.create",
        payload: {
          contentTypeId: eventContentTypeId,
          data: {
            slug: `bad-${crypto.randomUUID()}`,
            title: "Should Fail",
          },
        },
      }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("CONTENT_TYPE_TEMPLATE_MISMATCH");
  });

  it("rejects event creation with a program content type", async () => {
    const res = await app.request("/internal/cms-actions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Id": testWorkspaceId,
      },
      body: JSON.stringify({
        actionKey: "cms.event.create",
        payload: {
          contentTypeId: programContentTypeId,
          data: {
            slug: `bad-${crypto.randomUUID()}`,
            title: "Should Fail",
          },
        },
      }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("CONTENT_TYPE_TEMPLATE_MISMATCH");
  });
});
