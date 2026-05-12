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
 * CMS-API-KEY-ACTOR-1 (Story A) — Discriminated actor surface.
 *
 * Mirrors the contract emitted by `xynes-gateway`
 * (see `src/security/internalHeaders.ts` and `src/types/requestAuth.ts`)
 * and consumed downstream by `xynes-accounts-service` (PFU-1).
 *
 * - `user`:    request authenticated via a user JWT (legacy default).
 * - `api_key`: request authenticated via a workspace API key. The
 *              gateway has already enforced workspace + scope against
 *              the route's actionKey; downstream services MUST NOT
 *              re-run a user-based authz check on this actor.
 *
 * The raw API key is NEVER carried in the actor — only the public
 * `apiKeyId` (UUID) and 8-char `keyPrefix` surface here, matching the
 * gateway's redaction posture (Task 6 of the gateway API-key plan).
 */
export type UserActor = {
  kind: "user";
  userId: string;
};

export type ApiKeyActor = {
  kind: "api_key";
  apiKeyId: string;
  keyPrefix: string;
};

export type ActionActor = UserActor | ApiKeyActor;

/**
 * Context provided to action handlers from the HTTP request.
 *
 * CMS-API-KEY-ACTOR-1 (Story A): the optional `actor` field is the
 * preferred path for new handlers. Legacy handlers that read `userId`
 * directly continue to work — when the actor is `user`, both fields
 * are populated; when the actor is `api_key`, `userId` is `undefined`
 * (api_key callers have no human user identity).
 */
export interface ActionContext {
  workspaceId: string;
  userId?: string;
  /**
   * Discriminated actor surface. `undefined` when no actor was
   * resolved (anonymous public-route invocations, e.g.
   * `cms.comments.create` without `X-XS-User-Id`).
   */
  actor?: ActionActor;
  /**
   * Request correlation id propagated from the gateway / response
   * envelope. Optional to preserve backwards compatibility with
   * older test fixtures that synthesise an `ActionContext` directly.
   */
  requestId?: string;
}

export type ActionHandler<T = unknown, R = unknown> = (
  payload: T,
  ctx: ActionContext,
) => Promise<R>;

export interface RegisteredAction {
  handler: ActionHandler;
  schema: z.ZodSchema<unknown>;
}
