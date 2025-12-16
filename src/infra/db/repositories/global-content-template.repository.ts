import { asc } from "drizzle-orm";
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
