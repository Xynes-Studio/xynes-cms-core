import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  PublicationSummarySchema,
  readAvailablePublication,
} from "../../../actions/publication-snapshot";
import type {
  ContentDeliveryDirectoryOptions,
  ContentDeliveryEntryOptions,
} from "../../../actions/schemas/content-delivery";
import { db } from "../index";
import { contentEntries } from "../schema";
import {
  publicationReadColumns,
  validPublicationSql,
} from "./publication-validation";

export function buildDeliveryListQuery(
  options: ContentDeliveryDirectoryOptions & { workspaceId: string },
) {
  const entry = sql`${contentEntries.publishedSnapshot} -> 'entry'`;
  const title = sql<string>`(${entry} ->> 'title') collate "C"`;
  const publishedAt = sql<string>`${entry} ->> 'publishedAt'`;
  const summary = {
    id: contentEntries.id,
    title: sql<string>`${entry} ->> 'title'`,
    description: sql<string>`${entry} ->> 'description'`,
    tags: sql<unknown>`${entry} -> 'tags'`,
    publishedAt,
  };
  const pattern =
    options.search === undefined
      ? undefined
      : `%${options.search.replace(/[\\%_]/g, "\\$&")}%`;
  const order = options.sortDirection === "asc" ? asc : desc;
  return db
    .select(summary)
    .from(contentEntries)
    .where(
      and(
        eq(contentEntries.workspaceId, options.workspaceId),
        sql`${contentEntries.publishedSnapshot} ->> 'directoryId' = ${options.directoryId}`,
        validPublicationSql(),
        pattern === undefined
          ? undefined
          : sql`((${entry} ->> 'title') ilike ${pattern} escape '\\' or (${entry} ->> 'description') ilike ${pattern} escape '\\')`,
      ),
    )
    .orderBy(
      ...(options.sortBy === "title" ? [order(title)] : []),
      order(contentEntries.publishedAt),
      order(contentEntries.id),
    )
    .limit(options.limit + 1)
    .offset(options.offset);
}

export async function listDeliveryEntries(
  options: ContentDeliveryDirectoryOptions & { workspaceId: string },
) {
  const rows = await buildDeliveryListQuery(options);
  // Defense at the DB adapter boundary. A bad row is an error, never a fake empty feed.
  return rows.map((row) => PublicationSummarySchema.parse(row));
}

export function buildDeliveryEntryQuery(
  options: ContentDeliveryEntryOptions & { workspaceId: string },
) {
  return db
    .select(publicationReadColumns())
    .from(contentEntries)
    .where(
      and(
        eq(contentEntries.workspaceId, options.workspaceId),
        eq(contentEntries.id, options.entryId),
        validPublicationSql(),
      ),
    )
    .limit(1);
}

export async function getDeliveryEntry(
  options: ContentDeliveryEntryOptions & { workspaceId: string },
) {
  const [row] = await buildDeliveryEntryQuery(options);
  return row ? (readAvailablePublication(row)?.entry ?? null) : null;
}
