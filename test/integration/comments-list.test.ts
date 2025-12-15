import { beforeAll, describe, expect, it } from "bun:test";
import { and, eq } from "drizzle-orm";
import { app } from "../../src/index";
import { db } from "../../src/infra/db";
import {
  cmsComments,
  contentEntries,
  contentTypes,
  globalContentTemplates,
} from "../../src/infra/db/schema";

// Type for comment DTO response
interface CmsCommentDTO {
  id: string;
  parentId: string | null;
  displayName: string | null;
  userId: string | null;
  content: string;
  status: string;
  createdAt: string;
}

describe("POST /internal/cms-actions - cms.comments.listForEntry", () => {
  let testWorkspaceId: string;
  let testEntryId: string;
  let testContentTypeId: string;
  let approvedCommentId: string;
  let pendingCommentId: string;
  let replyCommentId: string;

  beforeAll(async () => {
    // Setup: Create prerequisite data
    testWorkspaceId = crypto.randomUUID();
    const templateKey = `comments_list_test_${Date.now()}`;

    // Create template
    await db.insert(globalContentTemplates).values({
      key: templateKey,
      fieldsSchema: {
        title: { type: "string", required: true },
        body: { type: "string", required: true },
      },
      description: "Test template for comments list action",
    });

    // Create content type
    const [contentType] = await db
      .insert(contentTypes)
      .values({
        workspaceId: testWorkspaceId,
        templateKey,
        name: "Blog Post",
        slug: "blog-post",
        config: {},
      })
      .returning();
    testContentTypeId = contentType.id;

    // Create content entry
    const [entry] = await db
      .insert(contentEntries)
      .values({
        workspaceId: testWorkspaceId,
        contentTypeId: testContentTypeId,
        data: { title: "Test Post", body: "Test body" },
        status: "published",
      })
      .returning();
    testEntryId = entry.id;

    // Create test comments with different statuses
    // Comment 1: Approved (oldest)
    const [approved] = await db
      .insert(cmsComments)
      .values({
        workspaceId: testWorkspaceId,
        entryId: testEntryId,
        content: "Approved comment",
        displayName: "Approved User",
        status: "approved",
      })
      .returning();
    approvedCommentId = approved.id;

    // Small delay to ensure different timestamps
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Comment 2: Pending
    const [pending] = await db
      .insert(cmsComments)
      .values({
        workspaceId: testWorkspaceId,
        entryId: testEntryId,
        content: "Pending comment",
        displayName: "Pending User",
        status: "pending",
      })
      .returning();
    pendingCommentId = pending.id;

    // Small delay to ensure different timestamps
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Comment 3: Approved reply (newest)
    const [reply] = await db
      .insert(cmsComments)
      .values({
        workspaceId: testWorkspaceId,
        entryId: testEntryId,
        parentId: approvedCommentId,
        content: "Reply to approved comment",
        displayName: "Reply User",
        status: "approved",
      })
      .returning();
    replyCommentId = reply.id;
  });

  it("should list only approved comments by default", async () => {
    const res = await app.request("/internal/cms-actions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Id": testWorkspaceId,
      },
      body: JSON.stringify({
        actionKey: "cms.comments.listForEntry",
        payload: {
          entryId: testEntryId,
        },
      }),
    });

    expect(res.status).toBe(200);
    const response = (await res.json()) as any;
    const body = response.data as CmsCommentDTO[];

    // Should only include approved comments
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(2); // 2 approved comments
    expect(body.every((c) => c.status === "approved")).toBe(true);
  });

  it("should list only pending comments when statusFilter='pending'", async () => {
    const res = await app.request("/internal/cms-actions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Id": testWorkspaceId,
      },
      body: JSON.stringify({
        actionKey: "cms.comments.listForEntry",
        payload: {
          entryId: testEntryId,
          statusFilter: "pending",
        },
      }),
    });

    expect(res.status).toBe(200);
    const response = (await res.json()) as any;
    const body = response.data as CmsCommentDTO[];

    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(1);
    expect(body[0].status).toBe("pending");
    expect(body[0].content).toBe("Pending comment");
  });

  it("should list all comments when statusFilter='all'", async () => {
    const res = await app.request("/internal/cms-actions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Id": testWorkspaceId,
      },
      body: JSON.stringify({
        actionKey: "cms.comments.listForEntry",
        payload: {
          entryId: testEntryId,
          statusFilter: "all",
        },
      }),
    });

    expect(res.status).toBe(200);
    const response = (await res.json()) as any;
    const body = response.data as CmsCommentDTO[];

    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(3); // All 3 comments

    // Should have both approved and pending
    const statuses = body.map((c) => c.status);
    expect(statuses).toContain("approved");
    expect(statuses).toContain("pending");
  });

  it("should return comments sorted by createdAt ascending", async () => {
    const res = await app.request("/internal/cms-actions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Id": testWorkspaceId,
      },
      body: JSON.stringify({
        actionKey: "cms.comments.listForEntry",
        payload: {
          entryId: testEntryId,
          statusFilter: "all",
        },
      }),
    });

    expect(res.status).toBe(200);
    const response = (await res.json()) as any;
    const body = response.data as CmsCommentDTO[];

    // Verify ascending order by createdAt
    for (let i = 1; i < body.length; i++) {
      const prevDate = new Date(body[i - 1].createdAt);
      const currDate = new Date(body[i].createdAt);
      expect(currDate.getTime()).toBeGreaterThanOrEqual(prevDate.getTime());
    }
  });

  it("should return DTO with correct shape", async () => {
    const res = await app.request("/internal/cms-actions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Id": testWorkspaceId,
      },
      body: JSON.stringify({
        actionKey: "cms.comments.listForEntry",
        payload: {
          entryId: testEntryId,
        },
      }),
    });

    expect(res.status).toBe(200);
    const response = (await res.json()) as any;
    const body = response.data as CmsCommentDTO[];

    expect(body.length).toBeGreaterThan(0);
    const comment = body[0];

    // Verify DTO shape
    expect(typeof comment.id).toBe("string");
    expect(
      comment.parentId === null || typeof comment.parentId === "string",
    ).toBe(true);
    expect(
      comment.displayName === null || typeof comment.displayName === "string",
    ).toBe(true);
    expect(comment.userId === null || typeof comment.userId === "string").toBe(
      true,
    );
    expect(typeof comment.content).toBe("string");
    expect(typeof comment.status).toBe("string");
    expect(typeof comment.createdAt).toBe("string");

    // createdAt should be ISO format
    expect(() => new Date(comment.createdAt)).not.toThrow();
  });

  it("should include replies with parentId", async () => {
    const res = await app.request("/internal/cms-actions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Id": testWorkspaceId,
      },
      body: JSON.stringify({
        actionKey: "cms.comments.listForEntry",
        payload: {
          entryId: testEntryId,
          includeReplies: true,
        },
      }),
    });

    expect(res.status).toBe(200);
    const response = (await res.json()) as any;
    const body = response.data as CmsCommentDTO[];

    // Find the reply
    const reply = body.find((c) => c.parentId === approvedCommentId);
    expect(reply).toBeDefined();
    expect(reply?.content).toBe("Reply to approved comment");
  });

  it("should return 404 for non-existent entryId", async () => {
    const fakeEntryId = crypto.randomUUID();

    const res = await app.request("/internal/cms-actions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Id": testWorkspaceId,
      },
      body: JSON.stringify({
        actionKey: "cms.comments.listForEntry",
        payload: {
          entryId: fakeEntryId,
        },
      }),
    });

    expect(res.status).not.toBe(200);
  });

  it("should return 404 for entry from different workspace", async () => {
    const differentWorkspaceId = crypto.randomUUID();

    const res = await app.request("/internal/cms-actions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Id": differentWorkspaceId,
      },
      body: JSON.stringify({
        actionKey: "cms.comments.listForEntry",
        payload: {
          entryId: testEntryId, // Entry belongs to testWorkspaceId
        },
      }),
    });

    expect(res.status).not.toBe(200);
  });

  it("should return empty array for entry with no comments", async () => {
    // Create another entry with no comments
    const [emptyEntry] = await db
      .insert(contentEntries)
      .values({
        workspaceId: testWorkspaceId,
        contentTypeId: testContentTypeId,
        data: { title: "Empty Post", body: "No comments here" },
        status: "published",
      })
      .returning();

    const res = await app.request("/internal/cms-actions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Id": testWorkspaceId,
      },
      body: JSON.stringify({
        actionKey: "cms.comments.listForEntry",
        payload: {
          entryId: emptyEntry.id,
        },
      }),
    });

    expect(res.status).toBe(200);
    const response = (await res.json()) as any;
    const body = response.data as CmsCommentDTO[];
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(0);
  });

  it("should return 400 for invalid entryId format", async () => {
    const res = await app.request("/internal/cms-actions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Id": testWorkspaceId,
      },
      body: JSON.stringify({
        actionKey: "cms.comments.listForEntry",
        payload: {
          entryId: "not-a-uuid",
        },
      }),
    });

    expect(res.status).toBe(400);
  });

  it("should return 400 for invalid statusFilter", async () => {
    const res = await app.request("/internal/cms-actions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Id": testWorkspaceId,
      },
      body: JSON.stringify({
        actionKey: "cms.comments.listForEntry",
        payload: {
          entryId: testEntryId,
          statusFilter: "invalid-status",
        },
      }),
    });

    expect(res.status).toBe(400);
  });

  it("should return 400 for missing entryId", async () => {
    const res = await app.request("/internal/cms-actions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Id": testWorkspaceId,
      },
      body: JSON.stringify({
        actionKey: "cms.comments.listForEntry",
        payload: {},
      }),
    });

    expect(res.status).toBe(400);
  });

  it("should paginate results with limit", async () => {
    // There are 2 approved comments. Limit 1 should return only 1.
    const res = await app.request("/internal/cms-actions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Id": testWorkspaceId,
      },
      body: JSON.stringify({
        actionKey: "cms.comments.listForEntry",
        payload: {
          entryId: testEntryId,
          limit: 1,
        },
      }),
    });

    expect(res.status).toBe(200);
    const response = (await res.json()) as any;
    const body = response.data as CmsCommentDTO[];
    expect(body.length).toBe(1);
    expect(body[0].id).toBe(approvedCommentId); // Oldest first
  });

  it("should paginate results with offset", async () => {
    // Offset 1 shoud skip the first approved comment
    const res = await app.request("/internal/cms-actions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Id": testWorkspaceId,
      },
      body: JSON.stringify({
        actionKey: "cms.comments.listForEntry",
        payload: {
          entryId: testEntryId,
          limit: 10,
          offset: 1,
        },
      }),
    });

    expect(res.status).toBe(200);
    const response = (await res.json()) as any;
    const body = response.data as CmsCommentDTO[];

    // Total approved is 2. Offset 1 means we get the remaining 1.
    expect(body.length).toBe(1);
    expect(body[0].id).toBe(replyCommentId); // Second approved comment
  });

  it("should return empty array when offset exceeds count", async () => {
    const res = await app.request("/internal/cms-actions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Id": testWorkspaceId,
      },
      body: JSON.stringify({
        actionKey: "cms.comments.listForEntry",
        payload: {
          entryId: testEntryId,
          offset: 100,
        },
      }),
    });

    expect(res.status).toBe(200);
    const response = (await res.json()) as any;
    const body = response.data as CmsCommentDTO[];
    expect(body.length).toBe(0);
  });
});
