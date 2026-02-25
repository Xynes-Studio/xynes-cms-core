import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../index";
import { contentDirectories } from "../schema";

export interface ContentDirectory {
  id: string;
  workspaceId: string;
  parentId: string | null;
  name: string;
  pathSegment: string;
  createdBy: string | null;
}

export async function listContentDirectoriesForWorkspace(
  workspaceId: string,
): Promise<ContentDirectory[]> {
  return await db
    .select({
      id: contentDirectories.id,
      workspaceId: contentDirectories.workspaceId,
      parentId: contentDirectories.parentId,
      name: contentDirectories.name,
      pathSegment: contentDirectories.pathSegment,
      createdBy: contentDirectories.createdBy,
    })
    .from(contentDirectories)
    .where(eq(contentDirectories.workspaceId, workspaceId))
    .orderBy(asc(contentDirectories.createdAt));
}

export async function findContentDirectoryByIdAndWorkspace(
  id: string,
  workspaceId: string,
): Promise<ContentDirectory | null> {
  const [row] = await db
    .select({
      id: contentDirectories.id,
      workspaceId: contentDirectories.workspaceId,
      parentId: contentDirectories.parentId,
      name: contentDirectories.name,
      pathSegment: contentDirectories.pathSegment,
      createdBy: contentDirectories.createdBy,
    })
    .from(contentDirectories)
    .where(
      and(
        eq(contentDirectories.id, id),
        eq(contentDirectories.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  return row ?? null;
}

export async function findContentDirectoryByWorkspaceParentAndPathSegment(input: {
  workspaceId: string;
  parentId: string | null;
  pathSegment: string;
}): Promise<ContentDirectory | null> {
  const [row] = await db
    .select({
      id: contentDirectories.id,
      workspaceId: contentDirectories.workspaceId,
      parentId: contentDirectories.parentId,
      name: contentDirectories.name,
      pathSegment: contentDirectories.pathSegment,
      createdBy: contentDirectories.createdBy,
    })
    .from(contentDirectories)
    .where(
      and(
        eq(contentDirectories.workspaceId, input.workspaceId),
        input.parentId === null
          ? isNull(contentDirectories.parentId)
          : eq(contentDirectories.parentId, input.parentId),
        eq(contentDirectories.pathSegment, input.pathSegment),
      ),
    )
    .limit(1);

  return row ?? null;
}

export async function createContentDirectory(input: {
  workspaceId: string;
  parentId: string | null;
  name: string;
  pathSegment: string;
  createdBy?: string | null;
}): Promise<ContentDirectory> {
  const [created] = await db
    .insert(contentDirectories)
    .values({
      workspaceId: input.workspaceId,
      parentId: input.parentId,
      name: input.name,
      pathSegment: input.pathSegment,
      createdBy: input.createdBy ?? null,
    })
    .returning({
      id: contentDirectories.id,
      workspaceId: contentDirectories.workspaceId,
      parentId: contentDirectories.parentId,
      name: contentDirectories.name,
      pathSegment: contentDirectories.pathSegment,
      createdBy: contentDirectories.createdBy,
    });

  return created;
}

export async function updateContentDirectoryByIdAndWorkspace(input: {
  id: string;
  workspaceId: string;
  name: string;
  pathSegment: string;
  updatedBy?: string | null;
}): Promise<ContentDirectory | null> {
  const [updated] = await db
    .update(contentDirectories)
    .set({
      name: input.name,
      pathSegment: input.pathSegment,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(contentDirectories.id, input.id),
        eq(contentDirectories.workspaceId, input.workspaceId),
      ),
    )
    .returning({
      id: contentDirectories.id,
      workspaceId: contentDirectories.workspaceId,
      parentId: contentDirectories.parentId,
      name: contentDirectories.name,
      pathSegment: contentDirectories.pathSegment,
      createdBy: contentDirectories.createdBy,
    });

  return updated ?? null;
}

export async function deleteContentDirectoriesByIdsAndWorkspace(input: {
  workspaceId: string;
  ids: string[];
}): Promise<number> {
  if (input.ids.length === 0) {
    return 0;
  }

  const deleted = await db
    .delete(contentDirectories)
    .where(
      and(
        eq(contentDirectories.workspaceId, input.workspaceId),
        inArray(contentDirectories.id, input.ids),
      ),
    )
    .returning({ id: contentDirectories.id });

  return deleted.length;
}

export async function withRootContentDirectoryPathMutex<T>(input: {
  workspaceId: string;
  pathSegment: string;
  run: () => Promise<T>;
}): Promise<T> {
  const lockScope = `cms.content_directories.root:${input.pathSegment}`;
  return await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${input.workspaceId}), hashtext(${lockScope}))`,
    );
    return await input.run();
  });
}
