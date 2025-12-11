import { z } from "zod";
import { type ActionHandler, type CmsActionKey, type RegisteredAction } from "./types";

const registry = new Map<CmsActionKey, RegisteredAction>();

export function registerAction<T>(
  key: CmsActionKey,
  handler: ActionHandler<T>,
  schema: z.ZodSchema<T>
) {
  registry.set(key, { handler, schema });
}

export function getActionHandler(key: CmsActionKey): RegisteredAction | undefined {
  return registry.get(key);
}
