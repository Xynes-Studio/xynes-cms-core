/**
 * Authz Check Middleware
 *
 * CMS-RBAC-1: Middleware to check permissions via authz service
 * before executing CMS actions.
 */

import { ForbiddenError, UnauthorizedError } from "../actions/errors";
import { getAuthzClient } from "../infra/authz";
import { logger } from "../infra/logger";

export interface AuthzContext {
  workspaceId: string;
  userId?: string;
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
 * CMS write actions include: create, update, publish, moderate, ensureDefaults
 */
function isWriteAction(actionKey: string): boolean {
  return (
    actionKey.includes(".create") ||
    actionKey.includes(".update") ||
    actionKey.includes(".publish") ||
    actionKey.includes(".moderate") ||
    actionKey.includes(".ensureDefaults")
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
  const { workspaceId, userId, requestId } = ctx;

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
