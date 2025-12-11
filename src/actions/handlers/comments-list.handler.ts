import { z } from "zod";
import type { ActionContext } from "../types";
import { EntryNotFoundError } from "../errors";
import {
  findEntryByIdAndWorkspace,
  listCommentsForEntry,
} from "../../infra/db/repositories/comment.repository";

/**
 * DTO for comments returned to the client.
 * Uses string dates for JSON serialization.
 */
export interface CmsCommentDTO {
  id: string;
  parentId: string | null;
  displayName: string | null;
  userId: string | null;
  content: string;
  status: string;
  createdAt: string;
}

/**
 * Schema for cms.comments.listForEntry payload.
 */
export const CommentsListForEntryPayloadSchema = z.object({
  entryId: z.string().uuid(),
  includeReplies: z.boolean().optional().default(true),
  statusFilter: z.enum(['approved', 'pending', 'all']).optional().default('approved'),
});

export type CommentsListForEntryPayload = z.infer<typeof CommentsListForEntryPayloadSchema>;

/**
 * Handler for cms.comments.listForEntry action.
 * 
 * Steps:
 * 1. Validate entryId belongs to ctx.workspaceId
 * 2. Query comments with status filter
 * 3. Transform to DTO format
 * 4. Return flat list sorted by createdAt ascending
 */
export async function handleCommentsListForEntry(
  payload: CommentsListForEntryPayload,
  ctx: ActionContext
): Promise<CmsCommentDTO[]> {
  const { entryId, statusFilter } = payload;
  const { workspaceId } = ctx;

  // Step 1: Verify entry belongs to workspace
  const entry = await findEntryByIdAndWorkspace(entryId, workspaceId);
  if (!entry) {
    throw new EntryNotFoundError(entryId);
  }

  // Step 2: Query comments with status filter
  const comments = await listCommentsForEntry({
    workspaceId,
    entryId,
    statusFilter,
  });

  // Step 3: Transform to DTO format
  const commentDTOs: CmsCommentDTO[] = comments.map((comment) => ({
    id: comment.id,
    parentId: comment.parentId,
    displayName: comment.displayName,
    userId: comment.userId,
    content: comment.content,
    status: comment.status,
    createdAt: comment.createdAt.toISOString(),
  }));

  return commentDTOs;
}
