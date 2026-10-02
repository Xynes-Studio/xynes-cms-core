import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  buildPublicationSnapshot,
  PublicationError,
} from "../../../actions/publication-snapshot";
import { db } from "../index";
import { contentEntries } from "../schema";
import {
  publicationDigestSql,
  validatedEntryColumns,
} from "./publication-validation";

type EntryRow = typeof contentEntries.$inferSelect;
type DraftPatch = Pick<Partial<EntryRow>, "data" | "directoryId" | "updatedBy">;
export interface PublicationMutation {
  entryId: string;
  workspaceId: string;
  contentTypeId?: string;
  patch?: DraftPatch;
  status?: "draft" | "scheduled" | "published" | "archived";
  publishedAt?: Date | null;
  scheduledOnly?: boolean;
}

export const ScheduledPublicationFailureSchema = z
  .object({
    revision: z.string().datetime(),
    code: z.enum([
      "PUBLICATION_INVALID",
      "PUBLICATION_TOO_LARGE",
      "TRANSIENT",
      "RETRY_EXHAUSTED",
    ]),
    attempts: z.number().int().min(1).max(3),
    nextAttemptAt: z.string().datetime().nullable(),
  })
  .strict();

function eligible(row: EntryRow, now: Date) {
  if (row.status !== "scheduled" || !row.publishedAt || row.publishedAt > now)
    return false;
  const result = ScheduledPublicationFailureSchema.safeParse(
    row.scheduledPublicationFailure,
  );
  if (!result.success) return row.scheduledPublicationFailure === null;
  const failure = result.data;
  return (
    failure.revision !== row.updatedAt.toISOString() ||
    (failure.code === "TRANSIENT" &&
      failure.nextAttemptAt !== null &&
      new Date(failure.nextAttemptAt) <= now)
  );
}

function scoped(input: PublicationMutation) {
  return and(
    eq(contentEntries.id, input.entryId),
    eq(contentEntries.workspaceId, input.workspaceId),
    isNull(contentEntries.deletedAt),
    input.contentTypeId
      ? eq(contentEntries.contentTypeId, input.contentTypeId)
      : undefined,
  );
}

async function recordScheduledFailure(
  input: PublicationMutation,
  source: EntryRow,
  error: unknown,
) {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(contentEntries)
      .where(scoped(input))
      .for("update");
    if (
      !row ||
      row.status !== "scheduled" ||
      row.updatedAt.getTime() !== source.updatedAt.getTime() ||
      row.directoryId !== source.directoryId ||
      row.publishedAt?.getTime() !== source.publishedAt?.getTime() ||
      JSON.stringify(row.data) !== JSON.stringify(source.data)
    )
      return;
    const revision = source.updatedAt;
    const previous = ScheduledPublicationFailureSchema.safeParse(
      row.scheduledPublicationFailure,
    );
    const attempts = Math.min(
      3,
      (previous.success && previous.data.revision === revision.toISOString()
        ? previous.data.attempts
        : 0) + 1,
    );
    const code =
      error instanceof PublicationError
        ? error.code
        : attempts === 3
          ? "RETRY_EXHAUSTED"
          : "TRANSIENT";
    const nextAttemptAt =
      code === "TRANSIENT"
        ? new Date(Date.now() + 30_000 * 2 ** (attempts - 1)).toISOString()
        : null;
    await tx
      .update(contentEntries)
      .set({
        scheduledPublicationFailure: {
          revision: revision.toISOString(),
          code,
          attempts,
          nextAttemptAt,
        },
      })
      .where(scoped(input));
  });
}

/** Lock the persisted draft, validate and commit publication state as one unit. */
export async function mutateEntryPublication(
  input: PublicationMutation,
): Promise<EntryRow | null> {
  let source: EntryRow | undefined;
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(contentEntries)
        .where(scoped(input))
        .for("update");
      if (!row) return null;
      const now = new Date();
      if (input.scheduledOnly && !eligible(row, now)) return null;
      source = row;
      if (input.status === "scheduled" && row.status === "published")
        throw new PublicationError();
      const status = input.status ?? row.status;
      const publishedAt = input.scheduledOnly
        ? row.publishedAt
        : input.status === "published"
          ? (input.publishedAt ?? now)
          : input.status === "scheduled"
            ? (input.publishedAt ?? null)
            : input.status
              ? null
              : row.publishedAt;
      const current = { ...row, ...input.patch };
      let digest: ReturnType<typeof publicationDigestSql> | undefined;
      const set: Partial<EntryRow> = {
        ...input.patch,
        updatedAt: now,
        scheduledPublicationFailure: null,
      };
      if (input.status) {
        set.status = status;
        set.publishedAt = publishedAt;
      }
      if (input.status === "published" || input.status === "scheduled") {
        if (
          !publishedAt ||
          (input.status === "scheduled" && publishedAt <= now)
        )
          throw new PublicationError();
        const snapshot = buildPublicationSnapshot(current, publishedAt);
        if (input.status === "published") {
          set.publishedSnapshot = snapshot;
          digest = publicationDigestSql(snapshot);
        }
      }
      const [updated] = await tx
        .update(contentEntries)
        .set({ ...set, ...(digest ? { publishedSnapshotDigest: digest } : {}) })
        .where(scoped(input))
        .returning(validatedEntryColumns());
      return updated ?? null;
    });
  } catch (error) {
    if (!input.scheduledOnly || !source) throw error;
    await recordScheduledFailure(input, source, error);
    return null;
  }
}

/** Create-with-publish validates before insertion; insert and publication cannot diverge. */
export async function createPublicationEntry(
  input: typeof contentEntries.$inferInsert,
): Promise<EntryRow> {
  const id = crypto.randomUUID();
  const publishedAt =
    input.publishedAt ?? (input.status === "published" ? new Date() : null);
  const snapshot =
    input.status === "published" || input.status === "scheduled"
      ? buildPublicationSnapshot(
          {
            id,
            directoryId: input.directoryId ?? null,
            documentId: input.documentId ?? null,
            data: input.data,
          },
          publishedAt ?? new Date(),
        )
      : null;
  if (
    input.status === "scheduled" &&
    (!publishedAt || publishedAt <= new Date())
  )
    throw new PublicationError();
  const [entry] = await db
    .insert(contentEntries)
    .values({
      ...input,
      id,
      publishedAt,
      publishedSnapshot: input.status === "published" ? snapshot : null,
      publishedSnapshotDigest:
        input.status === "published" && snapshot
          ? publicationDigestSql(snapshot)
          : null,
    })
    .returning(validatedEntryColumns());
  return entry;
}
