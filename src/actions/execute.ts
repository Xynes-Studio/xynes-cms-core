import { getActionHandler } from "./registry";
import type { ActionContext, CmsActionKey } from "./types";

export class UnknownActionError extends Error {
  constructor(key: string) {
    super(`Unknown action: ${key}`);
    this.name = "UnknownActionError";
  }
}

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
