import { z } from "zod";
import {
  createComment,
  findCommentByIdAndEntry,
} from "../../infra/db/repositories/comment.repository";
import { findEntryByIdAndWorkspace } from "../../infra/db/repositories/content-entry.repository";
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

export interface CommentsCreateDeps {
  findEntryByIdAndWorkspace: typeof findEntryByIdAndWorkspace;
  findCommentByIdAndEntry: typeof findCommentByIdAndEntry;
  createComment: typeof createComment;
}

/**
 * Handler for cms.comments.create action.
 *
 * Steps:
 * 1. Validate entryId belongs to ctx.workspaceId
 * 2. If parentId present, verify parent comment exists in same entry
 * 3. Insert comment with status = "pending"
 * 4. Return created comment row
 */
export function createHandleCommentsCreate(deps: CommentsCreateDeps) {
  return async function handleCommentsCreate(
    payload: CommentsCreatePayload,
    ctx: ActionContext,
  ) {
    const { entryId, parentId, displayName, content } = payload;
    const { workspaceId, userId } = ctx;

    const entry = await deps.findEntryByIdAndWorkspace(entryId, workspaceId);
    if (!entry) {
      throw new EntryNotFoundError(entryId);
    }

    if (parentId) {
      const parentComment = await deps.findCommentByIdAndEntry(
        parentId,
        entryId,
        workspaceId,
      );
      if (!parentComment) {
        throw new CommentNotFoundError(parentId);
      }
    }

    return await deps.createComment({
      workspaceId,
      entryId,
      parentId: parentId ?? null,
      userId: userId ?? null,
      displayName: displayName ?? null,
      content,
    });
  };
}

export const handleCommentsCreate = createHandleCommentsCreate({
  findEntryByIdAndWorkspace,
  findCommentByIdAndEntry,
  createComment,
});
