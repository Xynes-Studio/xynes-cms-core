import { z } from "zod";
import {
  createComment,
  findCommentByIdAndEntry,
} from "../../infra/db/repositories/comment.repository";
import {
  findEntryByIdAndWorkspace,
  findPublishedEntryByIdAndWorkspace,
} from "../../infra/db/repositories/content-entry.repository";
import {
  CommentNotFoundError,
  EntryNotFoundError,
  ValidationError,
} from "../errors";
import type { ActionContext } from "../types";

const MAX_COMMENT_CONTENT_LENGTH = 4000;
const MAX_ANON_COMMENT_CONTENT_LENGTH = 1000;

/**
 * Schema for cms.comments.create payload.
 */
export const CommentsCreatePayloadSchema = z.object({
  entryId: z.string().uuid(),
  parentId: z.string().uuid().nullable().optional(),
  displayName: z.string().trim().min(1).max(100).nullable().optional(),
  content: z.string().trim().min(1).max(MAX_COMMENT_CONTENT_LENGTH),
});

export type CommentsCreatePayload = z.infer<typeof CommentsCreatePayloadSchema>;

export interface CommentsCreateDeps {
  findEntryByIdAndWorkspace: typeof findEntryByIdAndWorkspace;
  findPublishedEntryByIdAndWorkspace: typeof findPublishedEntryByIdAndWorkspace;
  findCommentByIdAndEntry: typeof findCommentByIdAndEntry;
  createComment: typeof createComment;
}

/**
 * Handler for cms.comments.create action.
 *
 * Steps:
 * 1. Validate entryId belongs to ctx.workspaceId
 *    - For anonymous users: entry must be PUBLISHED (security: no commenting on drafts)
 *    - For authenticated users: entry just needs to exist in workspace
 * 2. If parentId present, verify parent comment exists in same entry
 * 3. Insert comment with status = "pending" (for moderation)
 * 4. Return created comment row
 *
 * Security measures for public comments (CMS-COMMENTS-PUBLIC-1):
 * - Anonymous users can only comment on published entries
 * - Anonymous comments have stricter content length limits (1000 chars vs 4000)
 * - All comments default to "pending" status for moderation
 * - displayName is validated (max 100 chars) to prevent abuse
 */
export function createHandleCommentsCreate(deps: CommentsCreateDeps) {
  return async function handleCommentsCreate(
    payload: CommentsCreatePayload,
    ctx: ActionContext,
  ) {
    const { entryId, parentId, displayName, content } = payload;
    const { workspaceId, userId } = ctx;
    const isAnonymous = !userId;

    // Enforce stricter content length for anonymous users
    if (isAnonymous && content.length > MAX_ANON_COMMENT_CONTENT_LENGTH) {
      throw new ValidationError(
        "Comment content is too long for anonymous use",
        {
          maxLength: MAX_ANON_COMMENT_CONTENT_LENGTH,
        },
      );
    }

    // Require displayName for anonymous users (better UX and spam reduction)
    if (isAnonymous && (!displayName || displayName.trim().length === 0)) {
      throw new ValidationError(
        "Display name is required for anonymous comments",
      );
    }

    // For anonymous users, only allow comments on PUBLISHED entries (security)
    // Authenticated users can comment on any entry they have access to
    let entry: Awaited<ReturnType<typeof deps.findEntryByIdAndWorkspace>> =
      null;
    if (isAnonymous) {
      entry = await deps.findPublishedEntryByIdAndWorkspace(
        entryId,
        workspaceId,
      );
      if (!entry) {
        // Don't reveal whether entry exists but is unpublished vs doesn't exist
        throw new EntryNotFoundError(entryId);
      }
    } else {
      entry = await deps.findEntryByIdAndWorkspace(entryId, workspaceId);
      if (!entry) {
        throw new EntryNotFoundError(entryId);
      }
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
  findPublishedEntryByIdAndWorkspace,
  findCommentByIdAndEntry,
  createComment,
});
