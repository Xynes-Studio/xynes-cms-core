import { eq, and, desc, lte } from "drizzle-orm";
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

export interface CreateEntryInput {
  workspaceId: string;
  contentTypeId: string;
  documentId?: string;
  status?: string;
  publishedAt?: Date | null;
  data: ContentEntryData;
}

/**
 * Create a new content entry.
 */
export async function createEntry(input: CreateEntryInput): Promise<ContentEntry> {
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

/**
 * Find a single entry by slug within a workspace + content type.
 */
export async function findEntryBySlug(
  workspaceId: string,
  contentTypeId: string,
  slug: string
): Promise<ContentEntry | null> {
  const results = await db
    .select()
    .from(contentEntries)
    .where(
      and(
        eq(contentEntries.workspaceId, workspaceId),
        eq(contentEntries.contentTypeId, contentTypeId)
      )
    );

  // Filter by slug in data (jsonb field)
  const entry = results.find((e) => (e.data as ContentEntryData)?.slug === slug);
  return entry ? (entry as ContentEntry) : null;
}

/**
 * List all entries for a workspace + content type.
 * Basic implementation without pagination for Sprint 1.
 */
export async function listEntriesByContentType(
  workspaceId: string,
  contentTypeId: string
): Promise<ContentEntry[]> {
  const results = await db
    .select()
    .from(contentEntries)
    .where(
      and(
        eq(contentEntries.workspaceId, workspaceId),
        eq(contentEntries.contentTypeId, contentTypeId)
      )
    );

  return results as ContentEntry[];
}

/**
 * Find a single PUBLISHED entry by slug.
 */
export async function findPublishedEntryBySlug(
  workspaceId: string,
  contentTypeId: string,
  slug: string
): Promise<ContentEntry | null> {
  const results = await db
    .select()
    .from(contentEntries)
    .where(
      and(
        eq(contentEntries.workspaceId, workspaceId),
        eq(contentEntries.contentTypeId, contentTypeId),
        eq(contentEntries.status, "published"),
        lte(contentEntries.publishedAt, new Date())
      )
    );

  // Filter by slug in data (jsonb field)
  const entry = results.find((e) => (e.data as ContentEntryData)?.slug === slug);
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
  tag?: string
): Promise<ContentEntry[]> {
  const query = db
    .select()
    .from(contentEntries)
    .where(
      and(
        eq(contentEntries.workspaceId, workspaceId),
        eq(contentEntries.contentTypeId, contentTypeId),
        eq(contentEntries.status, "published"),
        lte(contentEntries.publishedAt, new Date())
      )
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
