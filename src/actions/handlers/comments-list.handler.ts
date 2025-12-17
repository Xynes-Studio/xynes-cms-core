import { z } from "zod";
import { listCommentsForEntry } from "../../infra/db/repositories/comment.repository";
import { findEntryByIdAndWorkspace } from "../../infra/db/repositories/content-entry.repository";
import { EntryNotFoundError } from "../errors";
import type { ActionContext } from "../types";

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
  statusFilter: z
    .enum(["approved", "pending", "all"])
    .optional()
    .default("approved"),
  limit: z.number().int().min(1).optional().default(20),
  offset: z.number().int().min(0).optional().default(0),
});

export type CommentsListForEntryPayload = z.infer<
  typeof CommentsListForEntryPayloadSchema
>;

export interface CommentsListForEntryDeps {
  findEntryByIdAndWorkspace: typeof findEntryByIdAndWorkspace;
  listCommentsForEntry: typeof listCommentsForEntry;
}

/**
 * Handler for cms.comments.listForEntry action.
 *
 * Steps:
 * 1. Validate entryId belongs to ctx.workspaceId
 * 2. Query comments with status filter and pagination
 * 3. Transform to DTO format
 * 4. Return flat list sorted by createdAt ascending
 */
export function createHandleCommentsListForEntry(
  deps: CommentsListForEntryDeps,
) {
  return async function handleCommentsListForEntry(
    payload: CommentsListForEntryPayload,
    ctx: ActionContext,
  ): Promise<CmsCommentDTO[]> {
    const { entryId, statusFilter, limit, offset } = payload;
    const { workspaceId } = ctx;

    const entry = await deps.findEntryByIdAndWorkspace(entryId, workspaceId);
    if (!entry) {
      throw new EntryNotFoundError(entryId);
    }

    const comments = await deps.listCommentsForEntry({
      workspaceId,
      entryId,
      statusFilter,
      limit,
      offset,
    });

    return comments.map((comment) => ({
      id: comment.id,
      parentId: comment.parentId,
      displayName: comment.displayName,
      userId: comment.userId,
      content: comment.content,
      status: comment.status,
      createdAt: comment.createdAt.toISOString(),
    }));
  };
}

export const handleCommentsListForEntry = createHandleCommentsListForEntry({
  findEntryByIdAndWorkspace,
  listCommentsForEntry,
});
