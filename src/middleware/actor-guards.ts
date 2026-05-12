/**
 * Actor Guards (CMS-API-KEY-ACTOR-1, Story C)
 *
 * Handler-level guards for the discriminated `ActionContext.actor`
 * surface introduced in Story A.
 *
 * Story B added the gateway-trust short-circuit at the authz
 * middleware boundary — for any action whose `actionKey` is in an
 * MVP API key preset (`cms_authoring` / `cms_publisher` /
 * `cms_readonly`), an in-scope `api_key` actor passes authz without
 * a user check. Story C adds the second line of defense at the
 * handler boundary:
 *
 *   1. Handlers covered by an MVP preset accept either actor kind
 *      and decide locally how to populate audit columns
 *      (`created_by`, `updated_by`, `deleted_by`). For `api_key`
 *      actors these columns are written as `NULL` rather than a
 *      synthetic UUID — the actor identity is preserved out-of-band
 *      via the gateway telemetry pipeline (Task 5 of the gateway
 *      API-key plan emits `actorType`, `apiKeyId`, `keyPrefix`,
 *      `actionKey` on every request).
 *
 *   2. Handlers NOT in any MVP preset (`cms.entry.delete`,
 *      `cms.entry.collaborators.set`, `cms.entry.favorite.*`,
 *      `cms.entry.share.*`, `cms.content_directories.*`) call
 *      `requireUserActor(ctx)` at their top. Today the gateway
 *      scope check already 403s these for every MVP preset, but
 *      this guard is the handler-side belt-and-braces — should a
 *      future preset accidentally include one of these scopes, the
 *      handler still refuses with a stable `FORBIDDEN_ACTOR_KIND`
 *      code instead of silently corrupting audit-trail columns.
 *
 * Mirrors `xynes-accounts-service/src/actions/guards.ts`
 * `requireUserActor` (PFU-1, landed 2026-05-08 on `develop`).
 */

import { ForbiddenActorKindError, UnauthorizedError } from "../actions/errors";
import type { ActionContext, UserActor } from "../actions/types";

/**
 * Asserts that the request actor is a human user, returning the
 * `userId`. Throws when called by an `api_key` actor or by an
 * anonymous caller.
 *
 * @param ctx - The action context. The `actor` field is the
 *   authoritative discriminator; `ctx.userId` alone is treated as
 *   a legacy user actor for backwards compatibility with pre-Story-A
 *   callers that have not been migrated to the new surface.
 * @throws {ForbiddenActorKindError} 403 `FORBIDDEN_ACTOR_KIND` when
 *   `ctx.actor.kind === "api_key"`. The gateway scope check is the
 *   primary defense; this guard is a handler-level second line.
 * @throws {UnauthorizedError} 401 `UNAUTHORIZED` when no user
 *   identity is present (no `actor` and no legacy `userId`). Mirrors
 *   the message produced by the authz middleware for write actions
 *   so a missing-JWT regression is reported consistently.
 * @returns The resolved user id.
 */
export function requireUserActor(ctx: ActionContext): string {
  if (ctx.actor?.kind === "api_key") {
    throw new ForbiddenActorKindError(
      "This action requires a user actor and cannot be performed with an API key",
    );
  }

  const userId =
    ctx.actor?.kind === "user" ? ctx.actor.userId : ctx.userId ?? null;

  if (!userId) {
    throw new UnauthorizedError("User authentication required for this action");
  }

  return userId;
}

/**
 * Returns `true` when the request actor is an `api_key`. Use this in
 * handlers that accept both actor kinds but must branch on audit
 * policy (e.g. set `created_by = NULL` for an `api_key` create).
 *
 * Reads `ctx.actor` only — does NOT fall back to `ctx.userId`,
 * because the discriminator is authoritative. An `api_key` actor
 * with a stray `ctx.userId` (which the gateway never emits but
 * could be synthesised by a test fixture) is still treated as
 * `api_key`.
 */
export function isApiKeyActor(ctx: ActionContext): boolean {
  return ctx.actor?.kind === "api_key";
}

/**
 * Returns the resolved user id for handlers that accept either
 * actor kind but populate audit columns nullably. Returns `null`
 * when:
 *
 *   - the actor is `api_key` (no user identity), OR
 *   - the actor is `undefined` and `ctx.userId` is missing
 *     (anonymous public-route invocations).
 *
 * Use this for `created_by`/`updated_by` columns that are nullable
 * with `ON DELETE SET NULL`. Do NOT use it for FK columns that
 * require a non-null value (those handlers should call
 * {@link requireUserActor} instead).
 *
 * Returns the user identity (if any) for handlers that accept
 * either actor kind. Reads from `ctx.actor` when present and
 * falls back to the legacy `ctx.userId` field.
 */
export function getOptionalUserId(ctx: ActionContext): string | null {
  if (ctx.actor?.kind === "api_key") return null;
  if (ctx.actor?.kind === "user") return ctx.actor.userId;
  return ctx.userId ?? null;
}

/**
 * Convenience helper for handlers like `cms.entry.favorite.toggle`
 * that key on a `users.id` and therefore cannot be performed by an
 * `api_key` actor — favoriting is inherently a per-user feature.
 *
 * Alias for {@link requireUserActor} so handler call sites can read
 * intent at a glance.
 */
export const requireUserActorForUserScopedAction = requireUserActor;

export type { UserActor };
