import { z } from "zod";
import { listCommentsForEntry } from "../../infra/db/repositories/comment.repository";
import {
  findEntryByIdAndWorkspace,
  findPublishedEntryByIdAndWorkspace,
} from "../../infra/db/repositories/content-entry.repository";
import { EntryNotFoundError } from "../errors";
import { PUBLIC_LIST_MAX_LIMIT, zPaginationLimit } from "../pagination";
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
  limit: zPaginationLimit({
    defaultLimit: 20,
    maxLimit: PUBLIC_LIST_MAX_LIMIT,
  }),
  offset: z.number().int().min(0).finite().optional().default(0),
});

export type CommentsListForEntryPayload = z.infer<
  typeof CommentsListForEntryPayloadSchema
>;

export interface CommentsListForEntryDeps {
  findEntryByIdAndWorkspace: typeof findEntryByIdAndWorkspace;
  findPublishedEntryByIdAndWorkspace: typeof findPublishedEntryByIdAndWorkspace;
  listCommentsForEntry: typeof listCommentsForEntry;
}

/**
 * Handler for cms.comments.listForEntry action.
 *
 * Steps:
 * 1. Validate entryId belongs to ctx.workspaceId
 *    - For anonymous users: entry must be PUBLISHED (security: no listing comments on drafts)
 *    - For authenticated users: entry just needs to exist in workspace
 * 2. Query comments with status filter and pagination
 *    - Anonymous users can only see "approved" comments
 *    - Authenticated users can filter by status
 * 3. Transform to DTO format
 * 4. Return flat list sorted by createdAt ascending
 *
 * Security measures (CMS-COMMENTS-PUBLIC-1):
 * - Anonymous users can only list comments on published entries
 * - Anonymous users are forced to "approved" status filter
 */
export function createHandleCommentsListForEntry(
  deps: CommentsListForEntryDeps,
) {
  return async function handleCommentsListForEntry(
    payload: CommentsListForEntryPayload,
    ctx: ActionContext,
  ): Promise<CmsCommentDTO[]> {
    const { entryId, statusFilter, limit, offset } = payload;
    const { workspaceId, userId } = ctx;
    const isAnonymous = !userId;

    // For anonymous users, only allow listing comments on PUBLISHED entries (security)
    // Authenticated users can list comments on any entry they have access to
    let entry: Awaited<ReturnType<typeof deps.findEntryByIdAndWorkspace>> =
      null;
    if (isAnonymous) {
      entry = await deps.findPublishedEntryByIdAndWorkspace(
        entryId,
        workspaceId,
      );
    } else {
      entry = await deps.findEntryByIdAndWorkspace(entryId, workspaceId);
    }

    if (!entry) {
      throw new EntryNotFoundError(entryId);
    }

    // Force "approved" status filter for anonymous users
    const effectiveStatusFilter: typeof statusFilter = isAnonymous
      ? "approved"
      : statusFilter;

    const comments = await deps.listCommentsForEntry({
      workspaceId,
      entryId,
      statusFilter: effectiveStatusFilter,
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
  findPublishedEntryByIdAndWorkspace,
  listCommentsForEntry,
});
