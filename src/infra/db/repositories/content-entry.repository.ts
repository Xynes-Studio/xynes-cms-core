import { and, asc, desc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { db } from "../index";
import {
  contentEntries,
  contentEntryCollaborators,
  contentEntryFavorites,
} from "../schema";

export interface ContentEntryData {
  slug: string;
  title: string;
  excerpt?: string;
  tags?: string[];
  coverImageUrl?: string;
  publishedAt?: string | null;
  [key: string]: unknown;
}

export interface ContentEntry {
  id: string;
  workspaceId: string;
  contentTypeId: string;
  directoryId: string | null;
  documentId: string | null;
  data: ContentEntryData;
  status: string;
  publishedAt: Date | null;
  createdBy: string | null;
  updatedBy: string | null;
  deletedAt: Date | null;
  deletedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type ContentEntryStatus =
  | "draft"
  | "scheduled"
  | "published"
  | "archived";

function normalizedEntryDataSql() {
  // Some environments store `data` as a JSON string inside jsonb; normalize string/object to a jsonb object for field extraction.
  return sql`case
    when jsonb_typeof(${contentEntries.data}) = 'object' then ${contentEntries.data}
    when jsonb_typeof(${contentEntries.data}) = 'string'
      and left(ltrim(${contentEntries.data} #>> '{}'), 1) in ('{', '[')
      then (ltrim(${contentEntries.data} #>> '{}'))::jsonb
    else '{}'::jsonb
  end`;
}

export interface CreateEntryInput {
  workspaceId: string;
  contentTypeId: string;
  directoryId?: string | null;
  documentId?: string;
  status?: ContentEntryStatus;
  publishedAt?: Date | null;
  data: ContentEntryData;
  createdBy?: string | null;
  updatedBy?: string | null;
}

/**
 * Find a content entry by ID within a workspace.
 */
export async function findEntryByIdAndWorkspace(
  entryId: string,
  workspaceId: string,
): Promise<ContentEntry | null> {
  const [entry] = await db
    .select()
    .from(contentEntries)
    .where(
      and(
        eq(contentEntries.id, entryId),
        eq(contentEntries.workspaceId, workspaceId),
        isNull(contentEntries.deletedAt),
      ),
    )
    .limit(1);

  return entry ? (entry as ContentEntry) : null;
}

/**
 * Find a PUBLISHED content entry by ID within a workspace.
 * Used for public-facing operations like anonymous comments.
 */
export async function findPublishedEntryByIdAndWorkspace(
  entryId: string,
  workspaceId: string,
): Promise<ContentEntry | null> {
  const [entry] = await db
    .select()
    .from(contentEntries)
    .where(
      and(
        eq(contentEntries.id, entryId),
        eq(contentEntries.workspaceId, workspaceId),
        eq(contentEntries.status, "published"),
        lte(contentEntries.publishedAt, new Date()),
        isNull(contentEntries.deletedAt),
      ),
    )
    .limit(1);

  return entry ? (entry as ContentEntry) : null;
}

/**
 * Create a new content entry.
 */
export async function createEntry(
  input: CreateEntryInput,
): Promise<ContentEntry> {
  const [entry] = await db
    .insert(contentEntries)
    .values({
      workspaceId: input.workspaceId,
      contentTypeId: input.contentTypeId,
      directoryId: input.directoryId ?? null,
      documentId: input.documentId ?? null,
      data: input.data,
      status: input.status ?? "draft",
      publishedAt: input.publishedAt ?? null,
      createdBy: input.createdBy ?? null,
      updatedBy: input.updatedBy ?? input.createdBy ?? null,
    })
    .returning();

  return entry as ContentEntry;
}

export interface UpdateEntryInput {
  entryId: string;
  workspaceId: string;
  contentTypeId: string;
  data?: ContentEntryData;
  status?: ContentEntryStatus;
  publishedAt?: Date | null;
  updatedBy?: string | null;
}

/**
 * Update a content entry (scoped to workspace + content type).
 * Always updates updatedAt; optionally updates data/status/publishedAt.
 */
export async function updateEntryByIdAndWorkspace(
  input: UpdateEntryInput,
): Promise<ContentEntry | null> {
  const set: Record<string, unknown> = { updatedAt: new Date() };

  if (input.data !== undefined) set.data = input.data;
  if (input.status !== undefined) set.status = input.status;
  if (input.publishedAt !== undefined) set.publishedAt = input.publishedAt;
  if (input.updatedBy !== undefined) set.updatedBy = input.updatedBy;

  const [updated] = await db
    .update(contentEntries)
    .set(set)
    .where(
      and(
        eq(contentEntries.id, input.entryId),
        eq(contentEntries.workspaceId, input.workspaceId),
        eq(contentEntries.contentTypeId, input.contentTypeId),
        isNull(contentEntries.deletedAt),
      ),
    )
    .returning();

  return updated ? (updated as ContentEntry) : null;
}

/**
 * Find a single entry by slug within a workspace + content type.
 */
export async function findEntryBySlug(
  workspaceId: string,
  contentTypeId: string,
  slug: string,
): Promise<ContentEntry | null> {
  const normalizedData = normalizedEntryDataSql();
  const [entry] = await db
    .select()
    .from(contentEntries)
    .where(
      and(
        eq(contentEntries.workspaceId, workspaceId),
        eq(contentEntries.contentTypeId, contentTypeId),
        sql`(${normalizedData} ->> 'slug') = ${slug}`,
        isNull(contentEntries.deletedAt),
      ),
    )
    .limit(1);

  return entry ? (entry as ContentEntry) : null;
}

/**
 * List all entries for a workspace + content type.
 * Basic implementation without pagination for Sprint 1.
 */
export async function listEntriesByContentType(
  workspaceId: string,
  contentTypeId: string,
): Promise<ContentEntry[]> {
  const results = await db
    .select()
    .from(contentEntries)
    .where(
      and(
        eq(contentEntries.workspaceId, workspaceId),
        eq(contentEntries.contentTypeId, contentTypeId),
        isNull(contentEntries.deletedAt),
      ),
    );

  return results as ContentEntry[];
}

/**
 * Find a single PUBLISHED entry by slug.
 */
export async function findPublishedEntryBySlug(
  workspaceId: string,
  contentTypeId: string,
  slug: string,
): Promise<ContentEntry | null> {
  const normalizedData = normalizedEntryDataSql();
  const [entry] = await db
    .select()
    .from(contentEntries)
    .where(
      and(
        eq(contentEntries.workspaceId, workspaceId),
        eq(contentEntries.contentTypeId, contentTypeId),
        eq(contentEntries.status, "published"),
        lte(contentEntries.publishedAt, new Date()),
        sql`(${normalizedData} ->> 'slug') = ${slug}`,
        isNull(contentEntries.deletedAt),
      ),
    )
    .limit(1);

  return entry ? (entry as ContentEntry) : null;
}

/**
 * List PUBLISHED entries with pagination and optional tag filtering.
 * Ordered by publishedAt DESC.
 */
export async function listPublishedEntries(
  workspaceId: string,
  contentTypeId: string,
  limit = 10,
  offset = 0,
  tag?: string,
): Promise<ContentEntry[]> {
  const normalizedData = normalizedEntryDataSql();

  let where = and(
    eq(contentEntries.workspaceId, workspaceId),
    eq(contentEntries.contentTypeId, contentTypeId),
    eq(contentEntries.status, "published"),
    lte(contentEntries.publishedAt, new Date()),
    isNull(contentEntries.deletedAt),
  );

  if (tag) {
    where = and(where, sql`((${normalizedData} -> 'tags') ? ${tag})`);
  }

  const results = await db
    .select()
    .from(contentEntries)
    .where(where)
    .orderBy(desc(contentEntries.publishedAt))
    .limit(limit)
    .offset(offset);

  return results as ContentEntry[];
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  const asInt = Math.trunc(value);
  return Math.max(min, Math.min(max, asInt));
}

function escapeLikePattern(value: string): string {
  // Escape Postgres LIKE wildcards to keep "contains" semantics predictable.
  return value.replace(/[\\%_]/g, "\\$&");
}

export interface ListAdminEntriesInput {
  workspaceId: string;
  contentTypeId: string;
  status?: ContentEntryStatus; // undefined => all
  limit?: number;
  offset?: number;
  search?: string;
}

/**
 * List entries for admin UIs with status filtering, pagination, and search.
 * Ordered by updatedAt DESC.
 */
export async function listAdminEntries(
  input: ListAdminEntriesInput,
): Promise<ContentEntry[]> {
  const limit = clampInt(input.limit ?? 20, 1, 100);
  const offset = Math.max(0, Math.trunc(input.offset ?? 0));

  let where = and(
    eq(contentEntries.workspaceId, input.workspaceId),
    eq(contentEntries.contentTypeId, input.contentTypeId),
    isNull(contentEntries.deletedAt),
  );

  if (input.status) {
    where = and(where, eq(contentEntries.status, input.status));
  }

  if (input.search) {
    const pattern = `%${escapeLikePattern(input.search)}%`;
    const normalizedData = normalizedEntryDataSql();
    where = and(
      where,
      sql`(((${normalizedData} ->> 'title') ILIKE ${pattern} ESCAPE '\\') OR ((${normalizedData} ->> 'slug') ILIKE ${pattern} ESCAPE '\\'))`,
    );
  }

  const results = await db
    .select()
    .from(contentEntries)
    .where(where)
    .orderBy(desc(contentEntries.updatedAt))
    .limit(limit)
    .offset(offset);

  return results as ContentEntry[];
}

export interface UpdateEntryScopedInput {
  entryId: string;
  workspaceId: string;
  directoryId?: string | null;
  data?: ContentEntryData;
  status?: ContentEntryStatus;
  publishedAt?: Date | null;
  updatedBy?: string | null;
}

export async function updateEntryByIdAndWorkspaceScoped(
  input: UpdateEntryScopedInput,
): Promise<ContentEntry | null> {
  const set: Record<string, unknown> = { updatedAt: new Date() };

  if (input.data !== undefined) set.data = input.data;
  if (input.status !== undefined) set.status = input.status;
  if (input.publishedAt !== undefined) set.publishedAt = input.publishedAt;
  if (input.directoryId !== undefined) set.directoryId = input.directoryId;
  if (input.updatedBy !== undefined) set.updatedBy = input.updatedBy;

  const [updated] = await db
    .update(contentEntries)
    .set(set)
    .where(
      and(
        eq(contentEntries.id, input.entryId),
        eq(contentEntries.workspaceId, input.workspaceId),
        isNull(contentEntries.deletedAt),
      ),
    )
    .returning();

  return updated ? (updated as ContentEntry) : null;
}

export async function softDeleteEntryByIdAndWorkspace(input: {
  entryId: string;
  workspaceId: string;
  deletedBy: string;
}): Promise<ContentEntry | null> {
  const [updated] = await db
    .update(contentEntries)
    .set({
      deletedAt: new Date(),
      deletedBy: input.deletedBy,
      updatedBy: input.deletedBy,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(contentEntries.id, input.entryId),
        eq(contentEntries.workspaceId, input.workspaceId),
        isNull(contentEntries.deletedAt),
      ),
    )
    .returning();

  return updated ? (updated as ContentEntry) : null;
}

export async function publishEntryByIdAndWorkspace(input: {
  entryId: string;
  workspaceId: string;
  updatedBy?: string | null;
}): Promise<ContentEntry | null> {
  return setEntryStatusByIdAndWorkspace({
    entryId: input.entryId,
    workspaceId: input.workspaceId,
    status: "published",
    updatedBy: input.updatedBy,
  });
}

export interface SetEntryStatusInput {
  entryId: string;
  workspaceId: string;
  status: ContentEntryStatus;
  publishedAt?: Date | null;
  updatedBy?: string | null;
}

export async function setEntryStatusByIdAndWorkspace(
  input: SetEntryStatusInput,
): Promise<ContentEntry | null> {
  const now = new Date();
  const publishedAt =
    input.status === "published"
      ? now
      : input.status === "scheduled"
        ? input.publishedAt ?? null
        : null;
  const set: Record<string, unknown> = {
    status: input.status,
    publishedAt,
    updatedAt: now,
  };

  if (input.updatedBy !== undefined) set.updatedBy = input.updatedBy;

  const [updated] = await db
    .update(contentEntries)
    .set(set)
    .where(
      and(
        eq(contentEntries.id, input.entryId),
        eq(contentEntries.workspaceId, input.workspaceId),
        isNull(contentEntries.deletedAt),
      ),
    )
    .returning();

  return updated ? (updated as ContentEntry) : null;
}

export async function listDueScheduledEntries(
  limit: number,
): Promise<Array<Pick<ContentEntry, "id" | "workspaceId" | "publishedAt">>> {
  const normalizedLimit = Math.max(1, Math.min(200, Math.trunc(limit)));

  const results = await db
    .select({
      id: contentEntries.id,
      workspaceId: contentEntries.workspaceId,
      publishedAt: contentEntries.publishedAt,
    })
    .from(contentEntries)
    .where(
      and(
        eq(contentEntries.status, "scheduled"),
        lte(contentEntries.publishedAt, new Date()),
        isNull(contentEntries.deletedAt),
      ),
    )
    .orderBy(asc(contentEntries.publishedAt), asc(contentEntries.createdAt))
    .limit(normalizedLimit);

  return results as Array<
    Pick<ContentEntry, "id" | "workspaceId" | "publishedAt">
  >;
}

export async function publishScheduledEntryByIdAndWorkspace(input: {
  entryId: string;
  workspaceId: string;
}): Promise<ContentEntry | null> {
  const now = new Date();

  const [updated] = await db
    .update(contentEntries)
    .set({
      status: "published",
      updatedAt: now,
    })
    .where(
      and(
        eq(contentEntries.id, input.entryId),
        eq(contentEntries.workspaceId, input.workspaceId),
        eq(contentEntries.status, "scheduled"),
        lte(contentEntries.publishedAt, now),
        isNull(contentEntries.deletedAt),
      ),
    )
    .returning();

  return updated ? (updated as ContentEntry) : null;
}

export interface ListEntriesByDirectoryInput {
  workspaceId: string;
  directoryId?: string | null;
  status?: ContentEntryStatus;
  search?: string;
  sortBy?: "date" | "title" | "popularity";
  sortDirection?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

export async function listEntriesByDirectory(
  input: ListEntriesByDirectoryInput,
): Promise<ContentEntry[]> {
  const limit = clampInt(input.limit ?? 20, 1, 100);
  const offset = Math.max(0, Math.trunc(input.offset ?? 0));
  const normalizedData = normalizedEntryDataSql();

  let where = and(
    eq(contentEntries.workspaceId, input.workspaceId),
    isNull(contentEntries.deletedAt),
  );

  if (input.directoryId !== undefined && input.directoryId !== null) {
    where = and(where, eq(contentEntries.directoryId, input.directoryId));
  }

  if (input.status) {
    where = and(where, eq(contentEntries.status, input.status));
  }

  if (input.search) {
    const pattern = `%${escapeLikePattern(input.search)}%`;
    where = and(
      where,
      sql`(((${normalizedData} ->> 'title') ILIKE ${pattern} ESCAPE '\\') OR ((${normalizedData} ->> 'description') ILIKE ${pattern} ESCAPE '\\'))`,
    );
  }

  const sortBy = input.sortBy ?? "date";
  const sortDirection = input.sortDirection ?? "desc";

  const titleSql = sql<string>`(${normalizedData} ->> 'title')`;
  const popularitySql = sql<number>`case
    when (${normalizedData} ->> 'popularityScore') ~ '^[0-9]+$'
      then ((${normalizedData} ->> 'popularityScore'))::int
    else 0
  end`;

  const order =
    sortBy === "title"
      ? sortDirection === "asc"
        ? asc(titleSql)
        : desc(titleSql)
      : sortBy === "popularity"
        ? sortDirection === "asc"
          ? asc(popularitySql)
          : desc(popularitySql)
        : sortDirection === "asc"
          ? asc(contentEntries.updatedAt)
          : desc(contentEntries.updatedAt);

  const results = await db
    .select()
    .from(contentEntries)
    .where(where)
    .orderBy(order, desc(contentEntries.updatedAt))
    .limit(limit)
    .offset(offset);

  return results as ContentEntry[];
}

export interface EntryCollaboratorRow {
  entryId: string;
  userId: string;
  displayName: string | null;
}

export async function listEntryCollaboratorsByEntryIds(input: {
  workspaceId: string;
  entryIds: string[];
}): Promise<Map<string, EntryCollaboratorRow[]>> {
  const map = new Map<string, EntryCollaboratorRow[]>();
  if (!input.entryIds.length) return map;

  const rows = await db
    .select({
      entryId: contentEntryCollaborators.entryId,
      userId: contentEntryCollaborators.userId,
      displayName: contentEntryCollaborators.displayName,
    })
    .from(contentEntryCollaborators)
    .where(
      and(
        eq(contentEntryCollaborators.workspaceId, input.workspaceId),
        inArray(contentEntryCollaborators.entryId, input.entryIds),
      ),
    )
    .orderBy(asc(contentEntryCollaborators.createdAt));

  for (const row of rows) {
    const existing = map.get(row.entryId) ?? [];
    existing.push(row);
    map.set(row.entryId, existing);
  }

  return map;
}

export interface ReplaceEntryCollaboratorsInput {
  workspaceId: string;
  entryId: string;
  collaborators: Array<{ userId: string; displayName?: string | null }>;
}

export async function replaceEntryCollaborators(
  input: ReplaceEntryCollaboratorsInput,
): Promise<Array<{ userId: string; displayName: string | null }>> {
  return await db.transaction(async (tx) => {
    await tx
      .delete(contentEntryCollaborators)
      .where(
        and(
          eq(contentEntryCollaborators.workspaceId, input.workspaceId),
          eq(contentEntryCollaborators.entryId, input.entryId),
        ),
      );

    if (!input.collaborators.length) return [];

    const rows = input.collaborators.map((collaborator) => ({
      workspaceId: input.workspaceId,
      entryId: input.entryId,
      userId: collaborator.userId,
      displayName: collaborator.displayName ?? null,
    }));

    return await tx.insert(contentEntryCollaborators).values(rows).returning({
      userId: contentEntryCollaborators.userId,
      displayName: contentEntryCollaborators.displayName,
    });
  });
}

export async function toggleEntryFavorite(input: {
  workspaceId: string;
  entryId: string;
  userId: string;
}): Promise<{ isFavorite: boolean }> {
  return await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(contentEntryFavorites)
      .values({
        workspaceId: input.workspaceId,
        entryId: input.entryId,
        userId: input.userId,
      })
      .onConflictDoNothing()
      .returning({ id: contentEntryFavorites.id });

    if (inserted.length > 0) {
      return { isFavorite: true };
    }

    await tx
      .delete(contentEntryFavorites)
      .where(
        and(
          eq(contentEntryFavorites.workspaceId, input.workspaceId),
          eq(contentEntryFavorites.entryId, input.entryId),
          eq(contentEntryFavorites.userId, input.userId),
        ),
      );

    return { isFavorite: false };
  });
}

export async function listFavoriteEntryIdsByUser(input: {
  workspaceId: string;
  userId: string;
}): Promise<Set<string>> {
  const rows = await db
    .select({ entryId: contentEntryFavorites.entryId })
    .from(contentEntryFavorites)
    .where(
      and(
        eq(contentEntryFavorites.workspaceId, input.workspaceId),
        eq(contentEntryFavorites.userId, input.userId),
      ),
    );

  return new Set(rows.map((row) => row.entryId));
}

export async function listFavoritedEntriesByUser(input: {
  workspaceId: string;
  userId: string;
  limit?: number;
  offset?: number;
}): Promise<ContentEntry[]> {
  const limit = clampInt(input.limit ?? 20, 1, 100);
  const offset = Math.max(0, Math.trunc(input.offset ?? 0));

  const rows = await db
    .select({ entry: contentEntries })
    .from(contentEntries)
    .innerJoin(
      contentEntryFavorites,
      and(
        eq(contentEntryFavorites.entryId, contentEntries.id),
        eq(contentEntryFavorites.workspaceId, input.workspaceId),
        eq(contentEntryFavorites.userId, input.userId),
      ),
    )
    .where(
      and(
        eq(contentEntries.workspaceId, input.workspaceId),
        isNull(contentEntries.deletedAt),
      ),
    )
    .orderBy(desc(contentEntryFavorites.createdAt))
    .limit(limit)
    .offset(offset);

  return rows.map((row) => row.entry as ContentEntry);
}
