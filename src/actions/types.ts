import type { z } from "zod";

/**
 * Union type of all registered CMS action keys.
 * Extend this type when adding new actions.
 */
export type CmsActionKey =
  | "cms.content.create"
  | "cms.content.listPublished"
  | "cms.content.getPublishedBySlug"
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
  | "cms.content_types.ensureDefaults"
  | "cms.content_directories.listForWorkspace"
  | "cms.content_directories.create"
  | "cms.content_directories.update"
  | "cms.content_directories.delete"
  | "cms.entry.create"
  | "cms.entry.update"
  | "cms.entry.delete"
  | "cms.entry.publish"
  | "cms.entry.status.set"
  | "cms.entry.listByDirectory"
  | "cms.entry.getById"
  | "cms.entry.collaborators.set"
  | "cms.entry.favorite.toggle"
  | "cms.entry.favorite.list"
  | "cms.entry.share.generateInternalLink"
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
