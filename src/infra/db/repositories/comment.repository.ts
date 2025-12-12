import { eq, and } from "drizzle-orm";
import { db } from "../index";
import { contentEntries, cmsComments } from "../schema";

/**
 * Comment data structure returned from repository.
 */
export interface Comment {
  id: string;
  workspaceId: string;
  entryId: string;
  parentId: string | null;
  userId: string | null;
  displayName: string | null;
  content: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Input for creating a new comment.
 */
export interface CreateCommentInput {
  workspaceId: string;
  entryId: string;
  parentId?: string | null;
  userId?: string | null;
  displayName?: string | null;
  content: string;
}

/**
 * Find a content entry by ID and workspace.
 * Used to verify entry belongs to the workspace before creating a comment.
 */
export async function findEntryByIdAndWorkspace(
  entryId: string,
  workspaceId: string
): Promise<{ id: string; workspaceId: string } | null> {
  const [entry] = await db
    .select({ id: contentEntries.id, workspaceId: contentEntries.workspaceId })
    .from(contentEntries)
    .where(
      and(
        eq(contentEntries.id, entryId),
        eq(contentEntries.workspaceId, workspaceId)
      )
    )
    .limit(1);

  return entry ?? null;
}

/**
 * Find a comment by ID, entry, and workspace.
 * Used to verify parent comment exists for threaded replies.
 */
export async function findCommentByIdAndEntry(
  commentId: string,
  entryId: string,
  workspaceId: string
): Promise<Comment | null> {
  const [comment] = await db
    .select()
    .from(cmsComments)
    .where(
      and(
        eq(cmsComments.id, commentId),
        eq(cmsComments.entryId, entryId),
        eq(cmsComments.workspaceId, workspaceId)
      )
    )
    .limit(1);

  return comment ?? null;
}

/**
 * Create a new comment.
 * Sets status to "pending" by default for moderation.
 */
export async function createComment(input: CreateCommentInput): Promise<Comment> {
  const [comment] = await db
    .insert(cmsComments)
    .values({
      workspaceId: input.workspaceId,
      entryId: input.entryId,
      parentId: input.parentId ?? null,
      userId: input.userId ?? null,
      displayName: input.displayName ?? null,
      content: input.content,
      status: "pending",
    })
    .returning();

  return comment;
}

/**
 * Options for listing comments on an entry.
 */
export interface ListCommentsOptions {
  workspaceId: string;
  entryId: string;
  statusFilter?: 'approved' | 'pending' | 'all';
  limit?: number;
  offset?: number;
}

/**
 * List comments for an entry with optional status filtering.
 * Results are sorted by createdAt ascending (oldest first).
 */
export async function listCommentsForEntry(options: ListCommentsOptions): Promise<Comment[]> {
  const { 
    workspaceId, 
    entryId, 
    statusFilter = 'approved',
    limit = 20,
    offset = 0
  } = options;

  // Build query conditions
  const conditions = [
    eq(cmsComments.workspaceId, workspaceId),
    eq(cmsComments.entryId, entryId),
  ];

  // Add status filter if not 'all'
  if (statusFilter !== 'all') {
    conditions.push(eq(cmsComments.status, statusFilter));
  }

  const comments = await db
    .select()
    .from(cmsComments)
    .where(and(...conditions))
    .orderBy(cmsComments.createdAt)
    .limit(limit)
    .offset(offset);

  return comments;
}

