import { signedInit } from "../support/internal-request";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { and, eq, sql } from "drizzle-orm";
import postgres from "postgres";
import { z } from "zod";
import { handleBlogEntryCreate } from "../../src/actions/handlers/blog-entry.handler";
import {
  getDeliveryState,
  readPublicationSnapshot,
} from "../../src/actions/publication-snapshot";
import { app } from "../../src/index";
import { config } from "../../src/infra/config";
import { db } from "../../src/infra/db";
import {
  createEntry,
  findEntryByIdAndWorkspace,
  listDueScheduledEntries,
  publishEntryByIdAndWorkspace,
  publishScheduledEntryByIdAndWorkspace,
  setEntryStatusByIdAndWorkspace,
  softDeleteEntryByIdAndWorkspace,
  updateEntryByIdAndWorkspace,
  updateEntryByIdAndWorkspaceScoped,
} from "../../src/infra/db/repositories/content-entry.repository";
import { ScheduledPublicationFailureSchema } from "../../src/infra/db/repositories/content-publication.repository";
import { contentEntries, contentTypes } from "../../src/infra/db/schema";
import { runSeed } from "../../src/infra/db/seeders";
import { createScheduledEntryPublisher } from "../../src/scheduling/scheduled-entry-publisher";
import { INTERNAL_SERVICE_TOKEN } from "../support/internal-auth";

describe.skipIf(process.env.RUN_INTEGRATION_TESTS !== "true")(
  "Publication snapshots (isolated PostgreSQL)",
  () => {
    const workspaceId = crypto.randomUUID();
    let contentTypeId: string;
    beforeAll(async () => {
      await runSeed(db, workspaceId);
      const [type] = await db
        .select()
        .from(contentTypes)
        .where(eq(contentTypes.workspaceId, workspaceId));
      contentTypeId = type.id;
    });
    afterAll(async () => {
      await db
        .delete(contentEntries)
        .where(eq(contentEntries.workspaceId, workspaceId));
      await db
        .delete(contentTypes)
        .where(eq(contentTypes.workspaceId, workspaceId));
    });
    it("captures A, keeps A after saving B, and replaces it only on republish", async () => {
      const created = await createEntry({
        workspaceId,
        contentTypeId,
        data: { slug: "snapshot", title: "A", tags: ["alpha"] },
      });
      const published = await publishEntryByIdAndWorkspace({
        entryId: created.id,
        workspaceId,
        updatedBy: null,
      });
      expect(published).toHaveProperty(
        "publishedSnapshot",
        expect.objectContaining({
          version: 1,
          directoryId: null,
          entry: expect.objectContaining({
            id: created.id,
            title: "A",
            tags: ["alpha"],
          }),
        }),
      );
      await updateEntryByIdAndWorkspaceScoped({
        entryId: created.id,
        workspaceId,
        data: { slug: "snapshot", title: "B", tags: ["beta"] },
      });
      const saved = await findEntryByIdAndWorkspace(created.id, workspaceId);
      expect(saved).toHaveProperty(
        "publishedSnapshot",
        published?.publishedSnapshot,
      );
      const republished = await publishEntryByIdAndWorkspace({
        entryId: created.id,
        workspaceId,
      });
      expect(republished).toHaveProperty("publishedSnapshot.entry.title", "B");
    });
    it("adds real authoring availability without exposing snapshot/failure data, including API-key publish", async () => {
      const created = await createEntry({
        workspaceId,
        contentTypeId,
        data: {
          slug: "actor",
          title: "Actor",
          body: z
            .record(z.string(), z.unknown())
            .parse(
              JSON.parse(
                readFileSync(
                  "test/fixtures/cms-delivery/lexical-0.38.2.json",
                  "utf8",
                ),
              ),
            ),
        },
      });
      async function request(actionKey: string) {
        const response = await app.request(
          "/internal/cms-actions",
          signedInit("/internal/cms-actions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
              "X-Workspace-Id": workspaceId,
              "X-XS-Actor-Type": "api_key",
              "X-XS-API-Key-Id": crypto.randomUUID(),
              "X-XS-API-Key-Prefix": "1234abcd",
            },
            body: JSON.stringify({
              actionKey,
              payload: { entryId: created.id },
            }),
          }),
        );
        expect(response.status).toBe(200);
        const envelope = z
          .object({
            ok: z.literal(true),
            data: z.object({ entry: z.record(z.string(), z.unknown()) }),
          })
          .parse(await response.json());
        expect(envelope.data.entry).not.toHaveProperty("publishedSnapshot");
        expect(envelope.data.entry).not.toHaveProperty(
          "scheduledPublicationFailure",
        );
        return envelope.data.entry;
      }
      expect(await request("cms.entry.getById")).toHaveProperty(
        "deliveryState",
        "unpublished",
      );
      expect(await request("cms.entry.publish")).toHaveProperty(
        "deliveryState",
        "available",
      );
      const published = await findEntryByIdAndWorkspace(
        created.id,
        workspaceId,
      );
      expect(published?.updatedBy).toBeNull();
      expect(
        readPublicationSnapshot(published?.publishedSnapshot)?.entry.body,
      ).toHaveProperty("root.children", expect.any(Array));
      await db
        .update(contentEntries)
        .set({ publishedSnapshot: null })
        .where(eq(contentEntries.id, created.id));
      expect(await request("cms.entry.getById")).toHaveProperty(
        "deliveryState",
        "republish_required",
      );
    });
    it("does not expose new publication columns in legacy raw-entry responses", async () => {
      const result = await handleBlogEntryCreate(
        {
          contentTypeId,
          publishNow: true,
          data: { slug: "legacy", title: "Legacy" },
        },
        { workspaceId },
      );
      expect(result.entry).not.toHaveProperty("publishedSnapshot");
      expect(result.entry).not.toHaveProperty("scheduledPublicationFailure");
      expect(
        await findEntryByIdAndWorkspace(result.entry.id, workspaceId),
      ).toHaveProperty("publishedSnapshot.version", 1);
    });
    it("rejects invalid scheduling and leaves the current publication unchanged on validation failure", async () => {
      const entry = await createEntry({
        workspaceId,
        contentTypeId,
        status: "published",
        data: { slug: "rollback", title: "A" },
      });
      const saved = await updateEntryByIdAndWorkspaceScoped({
        entryId: entry.id,
        workspaceId,
        data: { slug: "rollback", title: "T".repeat(201) },
      });
      await expect(
        publishEntryByIdAndWorkspace({ entryId: entry.id, workspaceId }),
      ).rejects.toHaveProperty("code", "PUBLICATION_INVALID");
      const unchanged = await findEntryByIdAndWorkspace(entry.id, workspaceId);
      expect(unchanged?.publishedSnapshot).toEqual(entry.publishedSnapshot);
      expect(unchanged?.updatedAt).toEqual(saved?.updatedAt);
      expect(unchanged?.status).toBe("published");
      await expect(
        setEntryStatusByIdAndWorkspace({
          entryId: entry.id,
          workspaceId,
          status: "scheduled",
          publishedAt: new Date(Date.now() + 60_000),
        }),
      ).rejects.toHaveProperty("code", "PUBLICATION_INVALID");
    });
    it("preserves the last publication when a saved draft contains a credential-bearing external URL", async () => {
      const entry = await createEntry({
        workspaceId,
        contentTypeId,
        status: "published",
        data: { slug: "credential-url", title: "Safe" },
      });
      const saved = await updateEntryByIdAndWorkspaceScoped({
        entryId: entry.id,
        workspaceId,
        data: {
          slug: "credential-url",
          title: "Changed",
          body: {
            root: {
              type: "root",
              version: 1,
              children: [
                {
                  type: "image-block",
                  version: 1,
                  src: "https://public.invalid/image?access_token=synthetic-credential",
                },
              ],
            },
          },
        },
      });
      await expect(
        publishEntryByIdAndWorkspace({ entryId: entry.id, workspaceId }),
      ).rejects.toHaveProperty("code", "PUBLICATION_INVALID");
      const retained = await findEntryByIdAndWorkspace(entry.id, workspaceId);
      expect(retained?.publishedSnapshot).toEqual(entry.publishedSnapshot);
      expect(retained?.publishedAt).toEqual(entry.publishedAt);
      expect(retained?.updatedAt).toEqual(saved?.updatedAt);
      expect(getDeliveryState(retained ?? entry)).toBe("available");
    });
    it("rolls back status/time/snapshot when the database rejects the snapshot write", async () => {
      const entry = await createEntry({
        workspaceId,
        contentTypeId,
        status: "published",
        data: { slug: "db-rollback", title: "A" },
      });
      await updateEntryByIdAndWorkspaceScoped({
        entryId: entry.id,
        workspaceId,
        data: { slug: "db-rollback", title: "B" },
      });
      const before = await findEntryByIdAndWorkspace(entry.id, workspaceId);
      await db.execute(
        sql`create function cms.a2_reject_snapshot() returns trigger language plpgsql as $$ begin raise exception 'fixture snapshot write rejected'; end $$`,
      );
      await db.execute(
        sql.raw(
          `create trigger a2_reject_snapshot before update on cms.content_entries for each row when (NEW.id = '${entry.id}'::uuid AND NEW.published_snapshot IS DISTINCT FROM OLD.published_snapshot) execute function cms.a2_reject_snapshot()`,
        ),
      );
      try {
        await expect(
          publishEntryByIdAndWorkspace({ entryId: entry.id, workspaceId }),
        ).rejects.toThrow();
        expect(await findEntryByIdAndWorkspace(entry.id, workspaceId)).toEqual(
          before,
        );
      } finally {
        await db.execute(
          sql`drop trigger a2_reject_snapshot on cms.content_entries`,
        );
        await db.execute(sql`drop function cms.a2_reject_snapshot()`);
      }
    });
    it("waits for an in-flight draft save and captures one complete persisted revision under a row lock", async () => {
      const entry = await createEntry({
        workspaceId,
        contentTypeId,
        data: { slug: "race", title: "A", tags: ["a"] },
      });
      const writer = postgres(config.databaseUrl, { max: 1 });
      const observer = postgres(config.databaseUrl, { max: 1 });
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let locked: () => void = () => undefined;
      const ready = new Promise<void>((resolve) => {
        locked = resolve;
      });
      const saving = writer.begin(async (tx) => {
        await tx`select id from cms.content_entries where id=${entry.id} and workspace_id=${workspaceId} for update`;
        await tx`update cms.content_entries set data=${tx.json({ slug: "race", title: "B", tags: ["b"], body: null })}, updated_at=now() where id=${entry.id} and workspace_id=${workspaceId}`;
        locked();
        await gate;
      });
      await ready;
      const publishing = publishEntryByIdAndWorkspace({
        entryId: entry.id,
        workspaceId,
      });
      try {
        let waiting = false;
        for (let tries = 0; tries < 100 && !waiting; tries++) {
          const rows =
            await observer`select pid from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '%content_entries%'`;
          waiting = rows.length > 0;
          if (!waiting) await Bun.sleep(10);
        }
        expect(waiting).toBe(true);
        release();
        await saving;
        const published = await publishing;
        expect(
          readPublicationSnapshot(published?.publishedSnapshot)?.entry,
        ).toMatchObject({ title: "B", tags: ["b"], body: null });
      } finally {
        release();
        await saving;
        await publishing;
        await writer.end();
        await observer.end();
      }
    });
    it("keeps published folder membership frozen across a saved folder move", async () => {
      // NULL -> fixture folder proves draft identity does not substitute for publication identity.
      const entry = await createEntry({
        workspaceId,
        contentTypeId,
        status: "published",
        data: { slug: "folder", title: "Folder" },
      });
      await db.execute(
        sql`insert into cms.content_directories (workspace_id,name,path_segment) values (${workspaceId},'Fixture','fixture')`,
      );
      const rows = await db.execute<{ id: string }>(
        sql`select id from cms.content_directories where workspace_id=${workspaceId}`,
      );
      const folderId = rows[0].id;
      try {
        const saved = await updateEntryByIdAndWorkspaceScoped({
          entryId: entry.id,
          workspaceId,
          directoryId: folderId,
          data: { slug: "folder", title: "Moved", tags: ["new"] },
        });
        expect(
          readPublicationSnapshot(saved?.publishedSnapshot)?.directoryId,
        ).toBeNull();
        expect(getDeliveryState(saved ?? entry)).toBe("available");
        const published = await publishEntryByIdAndWorkspace({
          entryId: entry.id,
          workspaceId,
        });
        expect(
          readPublicationSnapshot(published?.publishedSnapshot)?.directoryId,
        ).toBe(folderId);
      } finally {
        await db.execute(
          sql`delete from cms.content_directories where id=${folderId} and workspace_id=${workspaceId}`,
        );
      }
    });
    it("hides retained snapshots immediately on archive/unpublish/delete and scopes publication by workspace/type", async () => {
      const entry = await createEntry({
        workspaceId,
        contentTypeId,
        status: "published",
        data: { slug: "hidden", title: "Hidden" },
      });
      expect(
        await publishEntryByIdAndWorkspace({
          entryId: entry.id,
          workspaceId: crypto.randomUUID(),
        }),
      ).toBeNull();
      expect(
        await updateEntryByIdAndWorkspace({
          entryId: entry.id,
          workspaceId,
          contentTypeId: crypto.randomUUID(),
          status: "published",
        }),
      ).toBeNull();
      for (const status of ["draft", "archived"] as const) {
        const changed = await setEntryStatusByIdAndWorkspace({
          entryId: entry.id,
          workspaceId,
          status,
        });
        expect(changed?.publishedSnapshot).toEqual(entry.publishedSnapshot);
        expect(getDeliveryState(changed ?? entry)).toBe("unpublished");
      }
      await publishEntryByIdAndWorkspace({ entryId: entry.id, workspaceId });
      const deleted = await softDeleteEntryByIdAndWorkspace({
        entryId: entry.id,
        workspaceId,
        deletedBy: "00000000-0000-4000-8000-000000000001",
      });
      expect(getDeliveryState(deleted ?? entry)).toBe("unpublished");
      expect(
        await publishEntryByIdAndWorkspace({ entryId: entry.id, workspaceId }),
      ).toBeNull();
    });
    it("isolates an invalid due legacy revision, publishes later entries, and recovers after an edit", async () => {
      const dueAt = new Date(Date.now() - 60_000);
      const [invalid] = await db
        .insert(contentEntries)
        .values({
          workspaceId,
          contentTypeId,
          status: "scheduled",
          publishedAt: dueAt,
          data: { slug: "invalid", title: "T".repeat(201) },
        })
        .returning();
      const [valid] = await db
        .insert(contentEntries)
        .values({
          workspaceId,
          contentTypeId,
          status: "scheduled",
          publishedAt: new Date(dueAt.getTime() + 1),
          data: { slug: "valid", title: "Valid" },
        })
        .returning();
      const scheduler = createScheduledEntryPublisher({ batchSize: 1 });
      await scheduler.runNow();
      const failed = await findEntryByIdAndWorkspace(invalid.id, workspaceId);
      const published = await findEntryByIdAndWorkspace(valid.id, workspaceId);
      expect(failed?.scheduledPublicationFailure).toMatchObject({
        code: "PUBLICATION_INVALID",
        attempts: 1,
        nextAttemptAt: null,
      });
      expect(failed?.updatedAt).toEqual(invalid.updatedAt);
      expect(published?.status).toBe("published");
      expect(
        getDeliveryState(
          published ?? {
            id: valid.id,
            status: "draft",
            publishedAt: null,
            deletedAt: null,
          },
        ),
      ).toBe("available");
      expect(
        (await listDueScheduledEntries(200)).some(
          (row) => row.id === invalid.id,
        ),
      ).toBe(false);
      await updateEntryByIdAndWorkspaceScoped({
        entryId: invalid.id,
        workspaceId,
        data: { slug: "invalid", title: "Recovered" },
      });
      await scheduler.runNow();
      expect(
        await findEntryByIdAndWorkspace(invalid.id, workspaceId),
      ).toHaveProperty("status", "published");
    });
    it("rejects oversize create-with-publish and isolates oversize due content without starving valid rows", async () => {
      const data = {
        slug: "oversize",
        title: "Large",
        body: {
          root: {
            type: "root",
            version: 1,
            children: [
              {
                type: "paragraph",
                version: 1,
                children: [
                  { type: "text", version: 1, text: "界".repeat(400_000) },
                ],
              },
            ],
          },
        },
      };
      await expect(
        createEntry({ workspaceId, contentTypeId, status: "published", data }),
      ).rejects.toHaveProperty("code", "PUBLICATION_TOO_LARGE");
      const dueAt = new Date(Date.now() - 60_000);
      const [oversize] = await db
        .insert(contentEntries)
        .values({
          workspaceId,
          contentTypeId,
          status: "scheduled",
          publishedAt: dueAt,
          data,
        })
        .returning();
      const [valid] = await db
        .insert(contentEntries)
        .values({
          workspaceId,
          contentTypeId,
          status: "scheduled",
          publishedAt: new Date(dueAt.getTime() + 1),
          data: { slug: "after-oversize", title: "Valid" },
        })
        .returning();
      await createScheduledEntryPublisher({ batchSize: 1 }).runNow();
      const failed = await findEntryByIdAndWorkspace(oversize.id, workspaceId);
      expect(failed?.publishedSnapshot).toBeNull();
      expect(failed?.updatedAt).toEqual(oversize.updatedAt);
      expect(failed?.scheduledPublicationFailure).toMatchObject({
        code: "PUBLICATION_TOO_LARGE",
        attempts: 1,
        nextAttemptAt: null,
      });
      expect(
        (await listDueScheduledEntries(200)).some(
          (row) => row.id === oversize.id,
        ),
      ).toBe(false);
      expect(
        await findEntryByIdAndWorkspace(valid.id, workspaceId),
      ).toHaveProperty("status", "published");
    });
    it("bounds transient retries/backoff and permits explicit reschedule recovery", async () => {
      const [entry] = await db
        .insert(contentEntries)
        .values({
          workspaceId,
          contentTypeId,
          status: "scheduled",
          publishedAt: new Date(Date.now() - 60_000),
          data: { slug: "transient", title: "Transient" },
        })
        .returning();
      await db.execute(
        sql`create function cms.a2_transient_failure() returns trigger language plpgsql as $$ begin raise exception 'fixture transient write rejected'; end $$`,
      );
      await db.execute(
        sql.raw(
          `create trigger a2_transient_failure before update on cms.content_entries for each row when (NEW.id = '${entry.id}'::uuid AND NEW.status = 'published') execute function cms.a2_transient_failure()`,
        ),
      );
      try {
        for (let attempt = 1; attempt <= 3; attempt++) {
          expect(
            await publishScheduledEntryByIdAndWorkspace({
              entryId: entry.id,
              workspaceId,
            }),
          ).toBeNull();
          const failed = await findEntryByIdAndWorkspace(entry.id, workspaceId);
          expect(failed?.updatedAt).toEqual(entry.updatedAt);
          const failure = ScheduledPublicationFailureSchema.parse(
            failed?.scheduledPublicationFailure,
          );
          expect(failure.attempts).toBe(attempt);
          expect(failure.code).toBe(
            attempt === 3 ? "RETRY_EXHAUSTED" : "TRANSIENT",
          );
          expect(
            (await listDueScheduledEntries(200)).some(
              (row) => row.id === entry.id,
            ),
          ).toBe(false);
          if (attempt < 3)
            await db
              .update(contentEntries)
              .set({
                scheduledPublicationFailure: {
                  ...failure,
                  nextAttemptAt: new Date(Date.now() - 1).toISOString(),
                },
              })
              .where(
                and(
                  eq(contentEntries.id, entry.id),
                  eq(contentEntries.workspaceId, workspaceId),
                ),
              );
        }
        const scheduled = await setEntryStatusByIdAndWorkspace({
          entryId: entry.id,
          workspaceId,
          status: "scheduled",
          publishedAt: new Date(Date.now() + 60_000),
        });
        expect(scheduled?.scheduledPublicationFailure).toBeNull();
        expect(
          await publishScheduledEntryByIdAndWorkspace({
            entryId: entry.id,
            workspaceId,
          }),
        ).toBeNull();
      } finally {
        await db.execute(
          sql`drop trigger a2_transient_failure on cms.content_entries`,
        );
        await db.execute(sql`drop function cms.a2_transient_failure()`);
      }
    });
    it("releases its advisory lock on the owning session while the application pool is busy", async () => {
      const observer = postgres(config.databaseUrl, { max: 1 });
      let pressure: Promise<unknown>[] = [];
      const scheduler = createScheduledEntryPublisher({
        listDueScheduledEntries: async () => {
          const owners =
            await observer`select pid from pg_locks where locktype='advisory' and objid=9143202 and granted`;
          expect(owners.length).toBe(1);
          pressure = Array.from({ length: 10 }, () =>
            Promise.resolve(
              db.execute(
                sql`select pg_sleep(case when pg_backend_pid()=${owners[0].pid} then 0.8 else 0.05 end)`,
              ),
            ),
          );
          await observer`select pg_sleep(0.03)`;
          return [];
        },
      });
      try {
        await scheduler.runNow();
        const rows =
          await observer`select pg_try_advisory_lock(9143202) as locked`;
        expect(rows[0].locked).toBe(true);
      } finally {
        await observer`select pg_advisory_unlock(9143202)`;
        await Promise.all(pressure);
        await observer.end();
      }
    });
  },
);
