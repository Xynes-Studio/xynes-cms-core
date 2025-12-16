import { z } from "zod";
import {
  createComment,
  findCommentByIdAndEntry,
  findEntryByIdAndWorkspace,
} from "../../infra/db/repositories/comment.repository";
import { CommentNotFoundError, EntryNotFoundError } from "../errors";
import type { ActionContext } from "../types";

/**
 * Schema for cms.comments.create payload.
 */
export const CommentsCreatePayloadSchema = z.object({
  entryId: z.string().uuid(),
  parentId: z.string().uuid().nullable().optional(),
  displayName: z.string().nullable().optional(),
  content: z.string().min(1),
});

export type CommentsCreatePayload = z.infer<typeof CommentsCreatePayloadSchema>;

/**
 * Handler for cms.comments.create action.
 *
 * Steps:
 * 1. Validate entryId belongs to ctx.workspaceId
 * 2. If parentId present, verify parent comment exists in same entry
 * 3. Insert comment with status = "pending"
 * 4. Return created comment row
 */
export async function handleCommentsCreate(
  payload: CommentsCreatePayload,
  ctx: ActionContext,
) {
  const { entryId, parentId, displayName, content } = payload;
  const { workspaceId, userId } = ctx;

  // Step 1: Verify entry belongs to workspace
  const entry = await findEntryByIdAndWorkspace(entryId, workspaceId);
  if (!entry) {
    throw new EntryNotFoundError(entryId);
  }

  // Step 2: If parentId present, verify parent comment exists
  if (parentId) {
    const parentComment = await findCommentByIdAndEntry(
      parentId,
      entryId,
      workspaceId,
    );
    if (!parentComment) {
      throw new CommentNotFoundError(parentId);
    }
  }

  // Step 3: Create the comment
  const comment = await createComment({
    workspaceId,
    entryId,
    parentId: parentId ?? null,
    userId: userId ?? null,
    displayName: displayName ?? null,
    content,
  });

  return comment;
}
