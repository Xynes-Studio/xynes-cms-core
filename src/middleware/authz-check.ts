/**
 * Authz Check Middleware
 *
 * CMS-RBAC-1: Middleware to check permissions via authz service
 * before executing CMS actions.
 *
 * CMS-API-KEY-ACTOR-1 (Story B): the middleware is now actor-aware.
 * When `ctx.actor.kind === "api_key"` the user-based authz check is
 * SHORT-CIRCUITED because the gateway has already enforced the route's
 * `actionKey` against the API key's scope set
 * (see `xynes-gateway/src/router/dynamicRouter.ts` Task 4 of the
 * gateway API-key plan). Re-running an authz user check downstream
 * would be a layering violation — the api_key actor carries no
 * `identity.users` row to check against. The handler is still
 * responsible for enforcing per-action audit policy via the optional
 * `requireUserActor` guard (Story C).
 */

import { ForbiddenError, UnauthorizedError } from "../actions/errors";
import type { ActionActor } from "../actions/types";
import { getAuthzClient } from "../infra/authz";
import { logger } from "../infra/logger";

export interface AuthzContext {
  workspaceId: string;
  userId?: string;
  /**
   * CMS-API-KEY-ACTOR-1 (Story B): discriminated actor surface
   * mirroring `ActionContext.actor`. Optional to preserve backwards
   * compatibility with legacy callers that only populate `userId`.
   */
  actor?: ActionActor;
  requestId?: string;
}

export interface AuthzMiddlewareOptions {
  /**
   * If true, throw UnauthorizedError when userId is missing.
   * Default: true for write actions (create, update, publish, moderate), false for read actions.
   */
  requireUserId?: boolean;
}

/**
 * Determines if an action is a write action (requires userId).
 * CMS write actions include: create, update, delete, publish, moderate, ensureDefaults
 */
function isWriteAction(actionKey: string): boolean {
  return (
    actionKey.includes(".create") ||
    actionKey.includes(".update") ||
    actionKey.includes(".delete") ||
    actionKey.includes(".publish") ||
    actionKey.includes(".moderate") ||
    actionKey.includes(".ensureDefaults") ||
    actionKey.includes(".set") ||
    actionKey.includes(".toggle") ||
    actionKey.includes(".share.")
  );
}

/**
 * Checks if the user has permission to perform the action.
 *
 * @param actionKey - The action key (e.g., 'cms.content.create')
 * @param ctx - The action context containing workspaceId and userId
 * @param options - Optional configuration
 * @throws {UnauthorizedError} If userId is required but missing
 * @throws {ForbiddenError} If user doesn't have permission
 */
export async function checkActionPermission(
  actionKey: string,
  ctx: AuthzContext,
  options: AuthzMiddlewareOptions = {},
): Promise<void> {
  const { workspaceId, userId, actor, requestId } = ctx;

  // CMS-API-KEY-ACTOR-1 (Story B): api_key actor short-circuit.
  //
  // The gateway has already enforced that the resolved API key's
  // scope set contains the route's `actionKey` (gateway Task 4) AND
  // that the API key is bound to this workspace (gateway workspace
  // ownership check). Re-running a user-based authz check here would
  // be a layering violation because the api_key actor has no
  // `identity.users` row. This short-circuit is the cms-core mirror
  // of `xynes-accounts-service/src/actions/guards.ts` `requirePermission`.
  //
  // Per-action audit policy (e.g. forbidding api_key on `cms.entry.delete`)
  // is the responsibility of Story C's `requireUserActor` handler-level
  // guard, NOT this middleware.
  if (actor?.kind === "api_key") {
    logger.debug(
      "[AuthzCheck] api_key actor — gateway-enforced scope, skipping user authz",
      {
        actionKey,
        workspaceId,
        requestId,
        apiKeyId: actor.apiKeyId,
        keyPrefix: actor.keyPrefix,
      },
    );
    return;
  }

  // Determine if userId is required
  const requireUserId = options.requireUserId ?? isWriteAction(actionKey);

  // Check if userId is required but missing
  if (requireUserId && !userId) {
    logger.warn("[AuthzCheck] Missing userId for write action", {
      actionKey,
      workspaceId,
      requestId,
    });
    throw new UnauthorizedError("User authentication required for this action");
  }

  // CMS-COMMENTS-PUBLIC-1: Skip authz check for anonymous users on public actions.
  // Public/anonymous actions explicitly don't require userId (requireUserId=false),
  // so when there's no userId, we skip the authz service call entirely.
  // The handler is responsible for security restrictions (published entries only,
  // content length limits, displayName required, etc.)
  if (!userId && !requireUserId) {
    logger.debug("[AuthzCheck] Skipping authz for anonymous public action", {
      actionKey,
      workspaceId,
      requestId,
    });
    return;
  }

  // Call authz service
  const authzClient = getAuthzClient();
  const result = await authzClient.check({
    userId: userId || "",
    workspaceId,
    actionKey,
  });

  if (!result.allowed) {
    logger.warn("[AuthzCheck] Permission denied", {
      actionKey,
      workspaceId,
      anonUserId: userId ? `${userId.slice(0, 8)}...` : "none",
      requestId,
    });
    throw new ForbiddenError(
      "You do not have permission to perform this action",
    );
  }

  logger.debug("[AuthzCheck] Permission granted", {
    actionKey,
    workspaceId,
    userId,
    requestId,
  });
}
