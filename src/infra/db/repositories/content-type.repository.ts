import { eq, and } from "drizzle-orm";
import { db } from "../index";
import { contentTypes } from "../schema";

export interface ContentType {
  id: string;
  workspaceId: string;
  templateKey: string;
  name: string;
  slug: string;
  config: unknown;
}

/**
 * Find content type by ID and verify workspace ownership.
 * Always use this for security to ensure workspace isolation.
 */
export async function findContentTypeByIdAndWorkspace(
  id: string,
  workspaceId: string
): Promise<ContentType | null> {
  const results = await db
    .select()
    .from(contentTypes)
    .where(
      and(
        eq(contentTypes.id, id),
        eq(contentTypes.workspaceId, workspaceId)
      )
    );
  
  return results[0] ?? null;
}

