import type { z } from "zod";

/**
 * Union type of all registered CMS action keys.
 * Extend this type when adding new actions.
 */
export type CmsActionKey =
  | "cms.blog_entry.create"
  | "cms.blog_entry.read"
  | "cms.blog_entry.listPublished"
  | "cms.blog_entry.getPublishedBySlug"
  | "cms.blog_entry.listAdmin"
  | "cms.blog_entry.updateMeta"
  | "cms.comments.create"
  | "cms.comments.listForEntry"
  | "cms.templates.listGlobal"
  | "cms.content_types.listForWorkspace"
  | (string & {}); // Allows string for dynamic registration while preserving autocomplete

/**
 * Context provided to action handlers from the HTTP request.
 */
export interface ActionContext {
  workspaceId: string;
  userId?: string;
}

export type ActionHandler<T = unknown, R = unknown> = (
  payload: T,
  ctx: ActionContext,
) => Promise<R>;

export interface RegisteredAction {
  handler: ActionHandler;
  schema: z.ZodSchema<unknown>;
}
