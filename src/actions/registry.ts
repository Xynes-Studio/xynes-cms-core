import type { z } from "zod";
import type { ActionHandler, CmsActionKey, RegisteredAction } from "./types";

const registry = new Map<CmsActionKey, RegisteredAction>();

export function registerAction<T>(
  key: CmsActionKey,
  handler: ActionHandler<T>,
  schema: z.ZodSchema<T>,
) {
  registry.set(key, {
    handler: handler as ActionHandler,
    schema: schema as z.ZodSchema<unknown>,
  });
}

export function getActionHandler(
  key: CmsActionKey,
): RegisteredAction | undefined {
  return registry.get(key);
}
