import { describe, it, expect, beforeAll } from "bun:test";
import { app } from "../../src/index";
import { db } from "../../src/infra/db";
import {
  globalContentTemplates,
  contentTypes,
  contentEntries,
  cmsComments,
} from "../../src/infra/db/schema";
import { eq } from "drizzle-orm";

// Type for comment response
interface CommentResponse {
  id: string;
  workspaceId: string;
  entryId: string;
  parentId: string | null;
  userId: string | null;
  displayName: string | null;
  content: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

describe("POST /internal/cms-actions - cms.comments.create", () => {
  let testWorkspaceId: string;
  let testEntryId: string;
  let testContentTypeId: string;

  beforeAll(async () => {
    // Setup: Create prerequisite data
    testWorkspaceId = crypto.randomUUID();
    const templateKey = `comments_action_test_${Date.now()}`;

    // Create template
    await db.insert(globalContentTemplates).values({
      key: templateKey,
      fieldsSchema: { title: "string", body: "string" },
      description: "Test template for comments action",
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
  });

  it("should create a comment with valid entryId", async () => {
    const res = await app.request("/internal/cms-actions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Id": testWorkspaceId,
      },
      body: JSON.stringify({
        actionKey: "cms.comments.create",
        payload: {
          entryId: testEntryId,
          content: "This is a test comment via action",
          displayName: "Test User",
        },
      }),
    });

    expect(res.status).toBe(200);
    const response = (await res.json()) as any;
    const body = response.data as CommentResponse;
    expect(body.id).toBeDefined();
    expect(body.entryId).toBe(testEntryId);
    expect(body.workspaceId).toBe(testWorkspaceId);
    expect(body.content).toBe("This is a test comment via action");
    expect(body.displayName).toBe("Test User");
    expect(body.status).toBe("pending");
    expect(body.parentId).toBeNull();

    // Verify DB state
    const [dbComment] = await db
      .select()
      .from(cmsComments)
      .where(eq(cmsComments.id, body.id));
    expect(dbComment).toBeDefined();
    expect(dbComment.content).toBe("This is a test comment via action");
  });

  it("should create a reply comment with valid parentId", async () => {
    // First create a parent comment
    const parentRes = await app.request("/internal/cms-actions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Id": testWorkspaceId,
      },
      body: JSON.stringify({
        actionKey: "cms.comments.create",
        payload: {
          entryId: testEntryId,
          content: "I am the parent comment",
          displayName: "Parent User",
        },
      }),
    });
    expect(parentRes.status).toBe(200);
    const parentResponse = (await parentRes.json()) as any;
    const parentComment = parentResponse.data as CommentResponse;

    // Now create a reply
    const replyRes = await app.request("/internal/cms-actions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Id": testWorkspaceId,
      },
      body: JSON.stringify({
        actionKey: "cms.comments.create",
        payload: {
          entryId: testEntryId,
          parentId: parentComment.id,
          content: "I am a reply",
          displayName: "Reply User",
        },
      }),
    });

    expect(replyRes.status).toBe(200);
    const replyResponse = (await replyRes.json()) as any;
    const replyComment = replyResponse.data as CommentResponse;
    expect(replyComment.parentId).toBe(parentComment.id);
    expect(replyComment.content).toBe("I am a reply");
  });

  it("should create comment with userId from context", async () => {
    const testUserId = crypto.randomUUID();

    const res = await app.request("/internal/cms-actions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Id": testWorkspaceId,
        "X-XS-User-Id": testUserId,
      },
      body: JSON.stringify({
        actionKey: "cms.comments.create",
        payload: {
          entryId: testEntryId,
          content: "Authenticated user comment",
        },
      }),
    });

    expect(res.status).toBe(200);
    const response = (await res.json()) as any;
    const body = response.data as CommentResponse;
    expect(body.userId).toBe(testUserId);
  });

  it("should return 404/500 for invalid entryId (wrong workspace)", async () => {
    const wrongWorkspaceId = crypto.randomUUID();

    const res = await app.request("/internal/cms-actions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Id": wrongWorkspaceId, // Different workspace
      },
      body: JSON.stringify({
        actionKey: "cms.comments.create",
        payload: {
          entryId: testEntryId, // Entry belongs to different workspace
          content: "This should fail",
        },
      }),
    });

    // EntryNotFoundError should result in non-200 response
    expect(res.status).not.toBe(200);
  });

  it("should return 404/500 for invalid entryId (non-existent)", async () => {
    const fakeEntryId = crypto.randomUUID();

    const res = await app.request("/internal/cms-actions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Id": testWorkspaceId,
      },
      body: JSON.stringify({
        actionKey: "cms.comments.create",
        payload: {
          entryId: fakeEntryId,
          content: "Entry does not exist",
        },
      }),
    });

    expect(res.status).not.toBe(200);
  });

  it("should return error for invalid parentId (non-existent)", async () => {
    const fakeParentId = crypto.randomUUID();

    const res = await app.request("/internal/cms-actions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Id": testWorkspaceId,
      },
      body: JSON.stringify({
        actionKey: "cms.comments.create",
        payload: {
          entryId: testEntryId,
          parentId: fakeParentId, // Does not exist
          content: "Reply to non-existent parent",
        },
      }),
    });

    expect(res.status).not.toBe(200);
  });

  it("should return 400 for missing content", async () => {
    const res = await app.request("/internal/cms-actions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Id": testWorkspaceId,
      },
      body: JSON.stringify({
        actionKey: "cms.comments.create",
        payload: {
          entryId: testEntryId,
          // Missing content
        },
      }),
    });

    expect(res.status).toBe(400);
  });

  it("should return 400 for invalid entryId format", async () => {
    const res = await app.request("/internal/cms-actions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Id": testWorkspaceId,
      },
      body: JSON.stringify({
        actionKey: "cms.comments.create",
        payload: {
          entryId: "not-a-uuid",
          content: "Invalid format",
        },
      }),
    });

    expect(res.status).toBe(400);
    const response = (await res.json()) as any;
    
    // Verify detailed validation error structure
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("VALIDATION_ERROR");
    expect(response.error.message).toBe("Payload validation failed");
    expect(response.error.details).toBeDefined();
    expect(response.error.details.issues).toBeArray();
    expect(response.error.details.issues[0].path).toEqual(["entryId"]);
    expect(response.error.details.issues[0].message).toContain("Invalid UUID"); // Zod's default message for invalid UUID
  });
});
