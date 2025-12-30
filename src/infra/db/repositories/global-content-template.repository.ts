import { asc, inArray } from "drizzle-orm";
import { db } from "../index";
import { globalContentTemplates } from "../schema";

export interface GlobalContentTemplate {
  id: string;
  key: string;
  fieldsSchema: unknown;
  description: string | null;
}

export async function listGlobalContentTemplates(): Promise<
  GlobalContentTemplate[]
> {
  return await db
    .select({
      id: globalContentTemplates.id,
      key: globalContentTemplates.key,
      fieldsSchema: globalContentTemplates.fieldsSchema,
      description: globalContentTemplates.description,
    })
    .from(globalContentTemplates)
    .orderBy(asc(globalContentTemplates.key));
}

/**
 * Finds existing template keys from a list of keys.
 * Used to check which templates already exist before seeding.
 */
export async function findExistingTemplateKeys(
  keys: string[],
): Promise<string[]> {
  if (keys.length === 0) return [];

  const rows = await db
    .select({ key: globalContentTemplates.key })
    .from(globalContentTemplates)
    .where(inArray(globalContentTemplates.key, keys));

  return rows.map((r) => r.key);
}
