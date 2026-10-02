import { and, getTableColumns, isNull, lte, sql } from "drizzle-orm";
import type { PublicationSnapshot } from "../../../actions/publication-snapshot";
import { contentEntries } from "../schema";

/** Canonicalization stays in PostgreSQL: JSON.stringify and JSONB text differ. */
export function publicationDigestSql(snapshot?: PublicationSnapshot) {
  const value = snapshot
    ? sql`${JSON.stringify(snapshot)}::jsonb`
    : sql`${contentEntries.publishedSnapshot}`;
  return sql<string>`('v1:' || encode(sha256(convert_to((${value})::text, 'UTF8')), 'hex'))`;
}

/** The service writes the digest only after the shared full validator succeeds. */
export function validPublicationSql() {
  return and(
    sql`${contentEntries.status} = 'published'`,
    isNull(contentEntries.deletedAt),
    lte(contentEntries.publishedAt, new Date()),
    sql`${contentEntries.publishedSnapshotDigest} is not null`,
    sql`${contentEntries.publishedSnapshotDigest} = ${publicationDigestSql()}`,
    sql`${contentEntries.publishedSnapshot} ->> 'version' = '1'`,
    sql`${contentEntries.publishedSnapshot} -> 'entry' ->> 'id' = ${contentEntries.id}::text`,
    sql`${contentEntries.publishedSnapshot} -> 'entry' ->> 'publishedAt' = to_char(${contentEntries.publishedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
  );
}

/** Internal computed metadata; never expose the digest or validation flag in DTOs. */
export function validatedEntryColumns() {
  return {
    ...getTableColumns(contentEntries),
    publishedSnapshotValidated: sql<boolean>`coalesce(${validPublicationSql()}, false)`,
  };
}

/** Public reads must never materialize the unrestricted current draft or audit fields. */
export function publicationReadColumns() {
  return {
    id: contentEntries.id,
    status: contentEntries.status,
    publishedAt: contentEntries.publishedAt,
    deletedAt: contentEntries.deletedAt,
    publishedSnapshot: contentEntries.publishedSnapshot,
    publishedSnapshotValidated: sql<boolean>`coalesce(${validPublicationSql()}, false)`,
  };
}

export type PublicationReadRow = Pick<
  typeof contentEntries.$inferSelect,
  "id" | "status" | "publishedAt" | "deletedAt"
> & { publishedSnapshot?: unknown; publishedSnapshotValidated?: boolean };

/** Bounded legacy summaries reuse the snapshot schema without fetching editor JSON. */
export function publicationListColumns() {
  const snapshot = sql`${contentEntries.publishedSnapshot}`;
  const entry = sql`${snapshot} -> 'entry'`;
  return {
    ...publicationReadColumns(),
    // Null is a summary-only sentinel: list DTOs never expose or validate a body.
    // The fingerprint gate still verifies the ORIGINAL complete stored snapshot.
    publishedSnapshot: sql<unknown>`jsonb_build_object(
      'version', ${snapshot} -> 'version',
      'directoryId', ${snapshot} -> 'directoryId',
      'entry', jsonb_build_object(
        'id', ${entry} -> 'id',
        'title', ${entry} -> 'title',
        'description', ${entry} -> 'description',
        'tags', ${entry} -> 'tags',
        'publishedAt', ${entry} -> 'publishedAt',
        'body', null
      ),
      'legacy', ${snapshot} -> 'legacy'
    )`,
  };
}
