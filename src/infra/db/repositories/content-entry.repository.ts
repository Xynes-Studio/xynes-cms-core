import { and, desc, eq, lte, sql } from "drizzle-orm";
import { db } from "../index";
import { contentEntries } from "../schema";

export interface ContentEntryData {
  slug: string;
  title: string;
  excerpt?: string;
  tags?: string[];
  coverImageUrl?: string;
  publishedAt?: string | null;
}

export interface ContentEntry {
  id: string;
  workspaceId: string;
  contentTypeId: string;
  documentId: string | null;
  data: ContentEntryData;
  status: string;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type ContentEntryStatus = "draft" | "published" | "archived";

export interface CreateEntryInput {
  workspaceId: string;
  contentTypeId: string;
  documentId?: string;
  status?: string;
  publishedAt?: Date | null;
  data: ContentEntryData;
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
      documentId: input.documentId ?? null,
      data: input.data,
      status: input.status ?? "draft",
      publishedAt: input.publishedAt ?? null,
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

  const [updated] = await db
    .update(contentEntries)
    .set(set)
    .where(
      and(
        eq(contentEntries.id, input.entryId),
        eq(contentEntries.workspaceId, input.workspaceId),
        eq(contentEntries.contentTypeId, input.contentTypeId),
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
  const results = await db
    .select()
    .from(contentEntries)
    .where(
      and(
        eq(contentEntries.workspaceId, workspaceId),
        eq(contentEntries.contentTypeId, contentTypeId),
      ),
    );

  // Filter by slug in data (jsonb field)
  const entry = results.find(
    (e) => (e.data as ContentEntryData)?.slug === slug,
  );
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
  const results = await db
    .select()
    .from(contentEntries)
    .where(
      and(
        eq(contentEntries.workspaceId, workspaceId),
        eq(contentEntries.contentTypeId, contentTypeId),
        eq(contentEntries.status, "published"),
        lte(contentEntries.publishedAt, new Date()),
      ),
    );

  // Filter by slug in data (jsonb field)
  const entry = results.find(
    (e) => (e.data as ContentEntryData)?.slug === slug,
  );
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
  const query = db
    .select()
    .from(contentEntries)
    .where(
      and(
        eq(contentEntries.workspaceId, workspaceId),
        eq(contentEntries.contentTypeId, contentTypeId),
        eq(contentEntries.status, "published"),
        lte(contentEntries.publishedAt, new Date()),
      ),
    )
    .orderBy(desc(contentEntries.publishedAt))
    .limit(limit)
    .offset(offset);

  const results = await query;

  if (tag) {
    // In-memory filter for now as per plan
    return (results as ContentEntry[]).filter((e) => {
      const tags = (e.data as ContentEntryData).tags;
      return Array.isArray(tags) && tags.includes(tag);
    });
  }

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
  );

  if (input.status) {
    where = and(where, eq(contentEntries.status, input.status));
  }

  if (input.search) {
    const pattern = `%${escapeLikePattern(input.search)}%`;
    const normalizedData = sql`case
      when jsonb_typeof(${contentEntries.data}) = 'object' then ${contentEntries.data}
      when jsonb_typeof(${contentEntries.data}) = 'string'
        and left(ltrim(${contentEntries.data} #>> '{}'), 1) in ('{', '[')
        then (ltrim(${contentEntries.data} #>> '{}'))::jsonb
      else '{}'::jsonb
    end`;
    where = and(
      where,
      // Some environments store `data` as a JSON string inside jsonb; normalize string/object to a jsonb object for field extraction.
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
