import { getActionHandler } from "./registry";
import type { ActionContext, CmsActionKey } from "./types";
import { UnknownActionError } from "./errors";

// Re-export for backwards compatibility
export { UnknownActionError };

export async function executeCmsAction(
  key: CmsActionKey,
  payload: unknown,
  ctx: ActionContext
) {
  const registered = getActionHandler(key);
  if (!registered) {
    throw new UnknownActionError(key);
  }

  const { handler, schema } = registered;

  // Validate payload
  const validatedPayload = schema.parse(payload);

  // Execute handler
  return handler(validatedPayload, ctx);
}

