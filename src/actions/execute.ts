import { checkActionPermission } from "../middleware/authz-check";
import { UnknownActionError } from "./errors";
import { getActionHandler } from "./registry";
import type { ActionContext, CmsActionKey } from "./types";

// Re-export for backwards compatibility
export { UnknownActionError };

/**
 * Actions that are considered public/read-only and don't require userId.
 * These still go through authz check but with requireUserId=false.
 */
const PUBLIC_READ_ACTIONS: Set<CmsActionKey> = new Set([
  "cms.content.listPublished",
  "cms.content.getPublishedBySlug",
  "cms.blog_entry.listPublished",
  "cms.blog_entry.getPublishedBySlug",
  "cms.comments.listForEntry",
  "cms.templates.listGlobal",
  "cms.content_types.listForWorkspace",
]);

/**
 * Actions that allow anonymous access (no userId required).
 * These are write actions that explicitly support unauthenticated users.
 * The handler is responsible for any additional restrictions (e.g., content length limits).
 */
const ANONYMOUS_ALLOWED_ACTIONS: Set<CmsActionKey> = new Set([
  "cms.comments.create", // Supports anonymous comments with content length limits
]);

/**
 * Determines if an action is a public read action.
 */
function isPublicReadAction(key: CmsActionKey): boolean {
  return PUBLIC_READ_ACTIONS.has(key);
}

/**
 * Determines if an action allows anonymous access.
 */
function allowsAnonymousAccess(key: CmsActionKey): boolean {
  return PUBLIC_READ_ACTIONS.has(key) || ANONYMOUS_ALLOWED_ACTIONS.has(key);
}

export async function executeCmsAction(
  key: CmsActionKey,
  payload: unknown,
  ctx: ActionContext,
) {
  const registered = getActionHandler(key);
  if (!registered) {
    throw new UnknownActionError(key);
  }

  // CMS-RBAC-1: Check permission before executing action
  await checkActionPermission(key, ctx, {
    requireUserId: !allowsAnonymousAccess(key),
  });

  const { handler, schema } = registered;

  // Validate payload
  const validatedPayload = schema.parse(payload);

  // Execute handler
  return handler(validatedPayload, ctx);
}
