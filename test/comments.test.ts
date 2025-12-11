import { describe, test, expect, beforeAll } from "bun:test";
import { db } from "../src/infra/db";
import {
	globalContentTemplates,
	contentTypes,
	contentEntries,
	cmsComments,
} from "../src/infra/db/schema";
import { eq, and } from "drizzle-orm";

describe("CMS Comments Table", () => {
	let testWorkspaceId: string;
	let testEntryId: string;
	let testContentTypeId: string;

	beforeAll(async () => {
		// Setup: Create prerequisite data
		testWorkspaceId = crypto.randomUUID();
		const templateKey = `comment_test_template_${Date.now()}`;

		// Create template
		await db.insert(globalContentTemplates).values({
			key: templateKey,
			fieldsSchema: { title: "string", body: "string" },
			description: "Test template for comments",
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

	test("should insert a top-level comment for an existing entry", async () => {
		const [comment] = await db
			.insert(cmsComments)
			.values({
				workspaceId: testWorkspaceId,
				entryId: testEntryId,
				content: "This is a test comment",
				displayName: "Test User",
				status: "pending",
			})
			.returning();

		expect(comment).toBeDefined();
		expect(comment.id).toBeDefined();
		expect(comment.entryId).toBe(testEntryId);
		expect(comment.workspaceId).toBe(testWorkspaceId);
		expect(comment.content).toBe("This is a test comment");
		expect(comment.displayName).toBe("Test User");
		expect(comment.status).toBe("pending");
		expect(comment.parentId).toBeNull();
		expect(comment.createdAt).toBeDefined();
		expect(comment.updatedAt).toBeDefined();
	});

	test("should insert a reply comment with parentId", async () => {
		// Create parent comment
		const [parentComment] = await db
			.insert(cmsComments)
			.values({
				workspaceId: testWorkspaceId,
				entryId: testEntryId,
				content: "Parent comment",
				displayName: "Parent User",
			})
			.returning();

		// Create reply
		const [replyComment] = await db
			.insert(cmsComments)
			.values({
				workspaceId: testWorkspaceId,
				entryId: testEntryId,
				parentId: parentComment.id,
				content: "This is a reply",
				displayName: "Reply User",
			})
			.returning();

		expect(replyComment).toBeDefined();
		expect(replyComment.parentId).toBe(parentComment.id);
		expect(replyComment.content).toBe("This is a reply");
	});

	test("should insert comment with authenticated userId", async () => {
		const testUserId = crypto.randomUUID();

		const [comment] = await db
			.insert(cmsComments)
			.values({
				workspaceId: testWorkspaceId,
				entryId: testEntryId,
				userId: testUserId,
				content: "Comment from authenticated user",
			})
			.returning();

		expect(comment).toBeDefined();
		expect(comment.userId).toBe(testUserId);
		expect(comment.displayName).toBeNull();
	});

	test("should query comments by workspaceId and entryId", async () => {
		// Insert multiple comments for the entry
		await db.insert(cmsComments).values([
			{
				workspaceId: testWorkspaceId,
				entryId: testEntryId,
				content: "Comment 1",
				displayName: "User 1",
			},
			{
				workspaceId: testWorkspaceId,
				entryId: testEntryId,
				content: "Comment 2",
				displayName: "User 2",
			},
		]);

		// Query comments
		const comments = await db
			.select()
			.from(cmsComments)
			.where(
				and(
					eq(cmsComments.workspaceId, testWorkspaceId),
					eq(cmsComments.entryId, testEntryId)
				)
			);

		expect(comments.length).toBeGreaterThanOrEqual(2);
		expect(comments.every((c) => c.workspaceId === testWorkspaceId)).toBe(true);
		expect(comments.every((c) => c.entryId === testEntryId)).toBe(true);
	});

	test("should update comment status", async () => {
		// Create a pending comment
		const [comment] = await db
			.insert(cmsComments)
			.values({
				workspaceId: testWorkspaceId,
				entryId: testEntryId,
				content: "Pending comment to approve",
				displayName: "Pending User",
				status: "pending",
			})
			.returning();

		expect(comment.status).toBe("pending");

		// Update status to approved
		const [updated] = await db
			.update(cmsComments)
			.set({ status: "approved", updatedAt: new Date() })
			.where(eq(cmsComments.id, comment.id))
			.returning();

		expect(updated.status).toBe("approved");
		// Compare seconds (database may truncate milliseconds)
		const createdSeconds = Math.floor(comment.createdAt.getTime() / 1000);
		const updatedSeconds = Math.floor(updated.updatedAt.getTime() / 1000);
		expect(updatedSeconds).toBeGreaterThanOrEqual(createdSeconds);
	});

	test("should default status to pending", async () => {
		const [comment] = await db
			.insert(cmsComments)
			.values({
				workspaceId: testWorkspaceId,
				entryId: testEntryId,
				content: "Default status comment",
				displayName: "Default User",
			})
			.returning();

		expect(comment.status).toBe("pending");
	});

	test("should reject invalid entryId due to FK constraint", async () => {
		const invalidEntryId = crypto.randomUUID();

		let error: Error | null = null;
		try {
			await db.insert(cmsComments).values({
				workspaceId: testWorkspaceId,
				entryId: invalidEntryId,
				content: "This should fail",
				displayName: "Test User",
			});
		} catch (e) {
			error = e as Error;
		}

		expect(error).not.toBeNull();
		expect(error?.message).toContain("violates foreign key constraint");
	});
});
