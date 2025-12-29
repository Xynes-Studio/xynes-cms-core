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
 * Determines if an action is a public read action.
 */
function isPublicReadAction(key: CmsActionKey): boolean {
  return PUBLIC_READ_ACTIONS.has(key);
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
    requireUserId: !isPublicReadAction(key),
  });

  const { handler, schema } = registered;

  // Validate payload
  const validatedPayload = schema.parse(payload);

  // Execute handler
  return handler(validatedPayload, ctx);
}
