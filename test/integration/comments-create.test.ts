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
import { INTERNAL_SERVICE_TOKEN } from "../support/internal-auth";

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

describe.skipIf(process.env.RUN_INTEGRATION_TESTS !== "true")(
  "POST /internal/cms-actions - cms.comments.create",
  () => {
    let testWorkspaceId: string;
    let testEntryId: string;
    let testDraftEntryId: string;
    let testContentTypeId: string;

    beforeAll(async () => {
      // Setup: Create prerequisite data
      testWorkspaceId = crypto.randomUUID();
      const templateKey = `comments_action_test_${crypto.randomUUID()}`;

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
          routeSegment: "blog",
          config: {},
        })
        .returning();
      testContentTypeId = contentType.id;

      // Create published content entry
      const [entry] = await db
        .insert(contentEntries)
        .values({
          workspaceId: testWorkspaceId,
          contentTypeId: testContentTypeId,
          data: { title: "Test Post", body: "Test body" },
          status: "published",
          publishedAt: new Date(),
        })
        .returning();
      testEntryId = entry.id;

      // Create draft content entry (for testing anonymous access restriction)
      const [draftEntry] = await db
        .insert(contentEntries)
        .values({
          workspaceId: testWorkspaceId,
          contentTypeId: testContentTypeId,
          data: { title: "Draft Post", body: "Draft body" },
          status: "draft",
          publishedAt: null,
        })
        .returning();
      testDraftEntryId = draftEntry.id;
    });

    it("should create a comment with valid entryId", async () => {
      const res = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
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
          "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
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
          "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
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
        "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
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
        "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
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
        "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
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
        "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
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
        "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
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
        "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
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
  },
);

// CMS-COMMENTS-PUBLIC-1: Anonymous Comment Creation Tests
describe.skipIf(process.env.RUN_INTEGRATION_TESTS !== "true")(
  "POST /internal/cms-actions - cms.comments.create (Anonymous/Public)",
  () => {
    let testWorkspaceId: string;
    let publishedEntryId: string;
    let draftEntryId: string;
    let futurePublishedEntryId: string;
    let testContentTypeId: string;

    beforeAll(async () => {
      testWorkspaceId = crypto.randomUUID();
      const templateKey = `anonymous_comments_test_${crypto.randomUUID()}`;

      await db.insert(globalContentTemplates).values({
        key: templateKey,
        fieldsSchema: { title: "string", body: "string" },
        description: "Test template for anonymous comments",
      });

      const [contentType] = await db
        .insert(contentTypes)
        .values({
          workspaceId: testWorkspaceId,
          templateKey,
          name: "Blog Post",
          slug: "blog-post",
          routeSegment: "blog",
          config: {},
        })
        .returning();
      testContentTypeId = contentType.id;

      // Published entry (anonymous comments allowed)
      const [publishedEntry] = await db
        .insert(contentEntries)
        .values({
          workspaceId: testWorkspaceId,
          contentTypeId: testContentTypeId,
          data: { title: "Published Post", body: "Published body" },
          status: "published",
          publishedAt: new Date(),
        })
        .returning();
      publishedEntryId = publishedEntry.id;

      // Draft entry (anonymous comments NOT allowed)
      const [draftEntry] = await db
        .insert(contentEntries)
        .values({
          workspaceId: testWorkspaceId,
          contentTypeId: testContentTypeId,
          data: { title: "Draft Post", body: "Draft body" },
          status: "draft",
          publishedAt: null,
        })
        .returning();
      draftEntryId = draftEntry.id;

      // Future published entry (anonymous comments NOT allowed - publishedAt in future)
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 7);
      const [futureEntry] = await db
        .insert(contentEntries)
        .values({
          workspaceId: testWorkspaceId,
          contentTypeId: testContentTypeId,
          data: { title: "Scheduled Post", body: "Scheduled body" },
          status: "published",
          publishedAt: futureDate,
        })
        .returning();
      futurePublishedEntryId = futureEntry.id;
    });

    it("should allow anonymous comment on published entry with displayName", async () => {
      // No X-XS-User-Id header = anonymous
      const res = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
          "X-Workspace-Id": testWorkspaceId,
          // No X-XS-User-Id header
        },
        body: JSON.stringify({
          actionKey: "cms.comments.create",
          payload: {
            entryId: publishedEntryId,
            content: "Great article!",
            displayName: "Anonymous Visitor",
          },
        }),
      });

      expect(res.status).toBe(200);
      const response = (await res.json()) as any;
      const body = response.data as CommentResponse;
      expect(body.id).toBeDefined();
      expect(body.userId).toBeNull();
      expect(body.displayName).toBe("Anonymous Visitor");
      expect(body.status).toBe("pending"); // Default moderation status
    });

    it("should reject anonymous comment without displayName", async () => {
      const res = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
          "X-Workspace-Id": testWorkspaceId,
        },
        body: JSON.stringify({
          actionKey: "cms.comments.create",
          payload: {
            entryId: publishedEntryId,
            content: "No name provided",
            // Missing displayName
          },
        }),
      });

      expect(res.status).toBe(400);
      const response = (await res.json()) as any;
      expect(response.error.message).toContain("Display name is required");
    });

    it("should reject anonymous comment on draft entry (security)", async () => {
      const res = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
          "X-Workspace-Id": testWorkspaceId,
        },
        body: JSON.stringify({
          actionKey: "cms.comments.create",
          payload: {
            entryId: draftEntryId,
            content: "Trying to comment on draft",
            displayName: "Hacker",
          },
        }),
      });

      // Should return error - anonymous cannot comment on non-published entries
      expect(res.status).not.toBe(200);
    });

    it("should reject anonymous comment on future-scheduled entry (security)", async () => {
      const res = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
          "X-Workspace-Id": testWorkspaceId,
        },
        body: JSON.stringify({
          actionKey: "cms.comments.create",
          payload: {
            entryId: futurePublishedEntryId,
            content: "Trying to comment on scheduled post",
            displayName: "Early Bird",
          },
        }),
      });

      // Should return error - scheduled posts are not yet public
      expect(res.status).not.toBe(200);
    });

    it("should reject anonymous comment exceeding 1000 character limit", async () => {
      const longContent = "a".repeat(1001);

      const res = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
          "X-Workspace-Id": testWorkspaceId,
        },
        body: JSON.stringify({
          actionKey: "cms.comments.create",
          payload: {
            entryId: publishedEntryId,
            content: longContent,
            displayName: "Long Writer",
          },
        }),
      });

      expect(res.status).toBe(400);
      const response = (await res.json()) as any;
      expect(response.error.message).toContain("too long");
    });

    it("should accept anonymous comment at exactly 1000 characters", async () => {
      const maxContent = "a".repeat(1000);

      const res = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
          "X-Workspace-Id": testWorkspaceId,
        },
        body: JSON.stringify({
          actionKey: "cms.comments.create",
          payload: {
            entryId: publishedEntryId,
            content: maxContent,
            displayName: "Max Writer",
          },
        }),
      });

      expect(res.status).toBe(200);
    });

    it("should allow authenticated user to comment on draft entry", async () => {
      const testUserId = crypto.randomUUID();

      const res = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
          "X-Workspace-Id": testWorkspaceId,
          "X-XS-User-Id": testUserId, // Authenticated
        },
        body: JSON.stringify({
          actionKey: "cms.comments.create",
          payload: {
            entryId: draftEntryId,
            content: "Admin can comment on draft",
          },
        }),
      });

      expect(res.status).toBe(200);
      const response = (await res.json()) as any;
      const body = response.data as CommentResponse;
      expect(body.userId).toBe(testUserId);
    });

    it("should allow authenticated user to post longer comments (up to 4000 chars)", async () => {
      const testUserId = crypto.randomUUID();
      const longContent = "a".repeat(3000);

      const res = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
          "X-Workspace-Id": testWorkspaceId,
          "X-XS-User-Id": testUserId,
        },
        body: JSON.stringify({
          actionKey: "cms.comments.create",
          payload: {
            entryId: publishedEntryId,
            content: longContent,
          },
        }),
      });

      expect(res.status).toBe(200);
    });
  },
);
