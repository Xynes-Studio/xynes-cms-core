import { signedInit } from "../support/internal-request";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import directoryFixture from "../fixtures/cms-delivery/responses/directory-success.json";
import { ContentDeliveryDirectoryPayloadSchema } from "../../src/actions/schemas/content-delivery";
import { buildDeliveryListQuery } from "../../src/infra/db/repositories/content-delivery.repository";
import { app } from "../../src/index";
import { db } from "../../src/infra/db";
import {
  createEntry,
  findEntryByIdAndWorkspace,
  publishEntryByIdAndWorkspace,
  publishScheduledEntryByIdAndWorkspace,
  setEntryStatusByIdAndWorkspace,
  updateEntryByIdAndWorkspaceScoped,
} from "../../src/infra/db/repositories/content-entry.repository";
import {
  contentDirectories,
  contentEntries,
  contentTypes,
} from "../../src/infra/db/schema";
import { runSeed } from "../../src/infra/db/seeders";
import { INTERNAL_SERVICE_TOKEN } from "../support/internal-auth";

const entrySchema = z
  .object({
    id: z.string().uuid(),
    title: z.string().optional(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
    publishedAt: z.string().optional(),
    body: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .strict();
const listEnvelope = z
  .object({
    ok: z.literal(true),
    data: z
      .object({
        items: z.array(entrySchema),
        page: z
          .object({
            limit: z.number(),
            offset: z.number(),
            hasMore: z.boolean(),
          })
          .strict(),
      })
      .strict(),
    meta: z.unknown().optional(),
  })
  .strict();
const detailEnvelope = z
  .object({
    ok: z.literal(true),
    data: z.object({ entry: entrySchema }).strict(),
    meta: z.unknown().optional(),
  })
  .strict();
const unavailable = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.literal("ENTRY_NOT_FOUND"),
    message: z.literal("Published content unavailable"),
  }),
  meta: z.unknown().optional(),
});

describe.skipIf(process.env.RUN_INTEGRATION_TESTS !== "true")(
  "bounded snapshot delivery (isolated PostgreSQL)",
  () => {
    const workspaceId = crypto.randomUUID();
    const foreignWorkspace = crypto.randomUUID();
    const folder = crypto.randomUUID();
    const movedFolder = crypto.randomUUID();
    let contentTypeId: string;
    beforeAll(async () => {
      await runSeed(db, workspaceId);
      const [type] = await db
        .select()
        .from(contentTypes)
        .where(eq(contentTypes.workspaceId, workspaceId));
      contentTypeId = type.id;
      await db.insert(contentDirectories).values([
        {
          id: folder,
          workspaceId,
          name: "Published folder",
          pathSegment: "published",
        },
        {
          id: movedFolder,
          workspaceId,
          name: "Draft folder",
          pathSegment: "draft",
        },
      ]);
    });
    afterAll(async () => {
      await db
        .delete(contentEntries)
        .where(eq(contentEntries.workspaceId, workspaceId));
      await db
        .delete(contentDirectories)
        .where(eq(contentDirectories.workspaceId, workspaceId));
      await db
        .delete(contentTypes)
        .where(eq(contentTypes.workspaceId, workspaceId));
    });
    async function create(
      title: string,
      options: {
        folder?: string;
        at?: Date;
        status?: "published" | "draft" | "scheduled";
        description?: string;
      } = {},
    ) {
      return createEntry({
        workspaceId,
        contentTypeId,
        directoryId: options.folder ?? folder,
        status: options.status ?? "published",
        publishedAt: options.at,
        data: {
          slug: crypto.randomUUID(),
          title,
          description: options.description ?? "Published summary",
          tags: ["fixture"],
          body: { root: { type: "root", version: 1, children: [] } },
          privateNote: "private fixture",
        },
      });
    }
    async function request(
      actionKey: string,
      payload: Record<string, unknown>,
      scope = workspaceId,
      headers: Record<string, string> = {},
    ) {
      const init = signedInit("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
          "X-Workspace-Id": scope,
          "X-XS-Actor-Type": "api_key",
          "X-XS-API-Key-Id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          "X-XS-API-Key-Prefix": "1234abcd",
          ...headers,
        },
        body: JSON.stringify({ actionKey, payload }),
      });
      // Tamper after signing so this negative case exercises the real verifier.
      if (Object.hasOwn(headers, "X-Internal-Service-Token")) {
        const signedHeaders = new Headers(init.headers);
        signedHeaders.set(
          "X-Internal-Service-Token",
          headers["X-Internal-Service-Token"],
        );
        return app.request("/internal/cms-actions", {
          ...init,
          headers: signedHeaders,
        });
      }
      return app.request("/internal/cms-actions", init);
    }
    async function list(
      payload: Record<string, unknown> = {},
      scope = workspaceId,
    ) {
      const response = await request(
        "cms.delivery.listByDirectory",
        { directoryId: folder, ...payload },
        scope,
      );
      expect(response.status).toBe(200);
      return listEnvelope.parse(await response.json()).data;
    }
    it("writes validation fingerprints atomically and preserves them on draft save", async () => {
      const entry = await create("Fingerprint");
      expect(entry).toHaveProperty(
        "publishedSnapshotDigest",
        expect.stringMatching(/^v1:[a-f0-9]{64}$/),
      );
      const [verified] = await db.execute(
        sql`select published_snapshot_digest = 'v1:' || encode(sha256(convert_to(published_snapshot::text, 'UTF8')), 'hex') as valid from cms.content_entries where id = ${entry.id}`,
      );
      expect(verified.valid).toBe(true);
      await updateEntryByIdAndWorkspaceScoped({
        entryId: entry.id,
        workspaceId,
        data: { slug: "edited", title: "Draft" },
      });
      expect(
        await findEntryByIdAndWorkspace(entry.id, workspaceId),
      ).toHaveProperty(
        "publishedSnapshotDigest",
        z.object({ publishedSnapshotDigest: z.string() }).parse(entry)
          .publishedSnapshotDigest,
      );
    });
    it("delivers published folder values after saves and changes membership only on republish", async () => {
      const entry = await create("Frozen A");
      await updateEntryByIdAndWorkspaceScoped({
        entryId: entry.id,
        workspaceId,
        directoryId: movedFolder,
        data: {
          slug: "draft",
          title: "Private B",
          description: "Private",
          tags: ["private"],
          body: { privateNode: "fixture" },
        },
      });
      const feed = await list({ search: "Frozen A" });
      expect(feed.items).toHaveLength(1);
      expect(feed.items[0]).toMatchObject({
        id: entry.id,
        title: "Frozen A",
        tags: ["fixture"],
      });
      expect(JSON.stringify(feed)).not.toMatch(
        /Private|body|privateNote|publishedSnapshot/,
      );
      expect((await list({ directoryId: movedFolder })).items).toEqual([]);
      const response = await request("cms.delivery.getById", {
        entryId: entry.id,
        fields: "title,body",
      });
      expect(response.status).toBe(200);
      expect(detailEnvelope.parse(await response.json()).data.entry).toEqual({
        id: entry.id,
        title: "Frozen A",
        body: { root: { type: "root", version: 1, children: [] } },
      });
      await expect(
        publishEntryByIdAndWorkspace({ entryId: entry.id, workspaceId }),
      ).rejects.toHaveProperty("code", "PUBLICATION_INVALID");
      await updateEntryByIdAndWorkspaceScoped({
        entryId: entry.id,
        workspaceId,
        data: { slug: "fixed", title: "Published B" },
      });
      await publishEntryByIdAndWorkspace({ entryId: entry.id, workspaceId });
      expect((await list({ search: "Frozen A" })).items).toEqual([]);
      expect((await list({ directoryId: movedFolder })).items).toHaveLength(1);
    });
    it("excludes missing, changed or invalid-body snapshots before paging and fails detail uniformly", async () => {
      const valid = await create("Recovery valid", {
        at: new Date("2020-01-01"),
      });
      const invalid = await create("Recovery invalid");
      await db
        .update(contentEntries)
        .set({
          publishedSnapshot: sql`jsonb_set(${contentEntries.publishedSnapshot}, '{entry,body}', '{"root":{"type":"root","version":1,"children":[{"type":"private-unknown","version":1}]}}'::jsonb)`,
        })
        .where(eq(contentEntries.id, invalid.id));
      const historical = await create("Recovery historical");
      await db
        .update(contentEntries)
        .set({ publishedSnapshotDigest: null })
        .where(eq(contentEntries.id, historical.id));
      const feed = await list({ search: "Recovery", limit: 1 });
      expect(feed.items).toEqual([expect.objectContaining({ id: valid.id })]);
      expect(feed.page.hasMore).toBe(false);
      for (const entryId of [invalid.id, historical.id, crypto.randomUUID()]) {
        const response = await request("cms.delivery.getById", { entryId });
        expect(response.status).toBe(404);
        unavailable.parse(await response.json());
      }
      const authoring = await request("cms.entry.getById", {
        entryId: invalid.id,
      });
      expect(authoring.status).toBe(200);
      expect(
        z
          .object({
            data: z.object({
              entry: z.object({
                deliveryState: z.literal("republish_required"),
              }),
            }),
          })
          .safeParse(await authoring.json()).success,
      ).toBe(true);
      await publishEntryByIdAndWorkspace({ entryId: invalid.id, workspaceId });
      expect((await list({ search: "Recovery invalid" })).items).toHaveLength(
        1,
      );
    });
    it("has deterministic title/time/id ordering and truthful limit+1 pages", async () => {
      const at = new Date("2021-01-01");
      const one = await create("Sort fixture", { at });
      const two = await create("Sort fixture", { at });
      for (const sortBy of ["publishedAt", "title"])
        for (const sortDirection of ["asc", "desc"]) {
          const ids = [one.id, two.id].sort();
          if (sortDirection === "desc") ids.reverse();
          expect(
            (
              await list({ search: "Sort fixture", sortBy, sortDirection })
            ).items.map((entry) => entry.id),
          ).toEqual(ids);
          const first = await list({
            search: "Sort fixture",
            sortBy,
            sortDirection,
            limit: 1,
          });
          expect(first.items[0]?.id).toBe(ids[0]);
          expect(first.page).toEqual({ limit: 1, offset: 0, hasMore: true });
          const second = await list({
            search: "Sort fixture",
            sortBy,
            sortDirection,
            limit: 1,
            offset: 1,
          });
          expect(second.items[0]?.id).toBe(ids[1]);
          expect(second.page.hasMore).toBe(false);
        }
    });
    it("sorts distinct published titles independently of publication time", async () => {
      const older = await create("Distinct sort Zebra", {
        at: new Date("2020-01-01"),
      });
      const newer = await create("Distinct sort Alpha", {
        at: new Date("2022-01-01"),
      });
      for (const direction of ["asc", "desc"]) {
        const dateIds = [older.id, newer.id];
        const titleIds = [newer.id, older.id];
        if (direction === "desc") {
          dateIds.reverse();
          titleIds.reverse();
        }
        for (const [sortBy, ids] of [
          ["publishedAt", dateIds],
          ["title", titleIds],
        ] as const) {
          expect(
            (
              await list({
                search: "Distinct sort",
                sortBy,
                sortDirection: direction,
              })
            ).items.map((item) => item.id),
          ).toEqual(ids);
        }
      }
    });
    it("serializes real persisted summaries against the pinned A1 response fixture", async () => {
      const entry = await create("Harmless publication", {
        at: new Date("2026-10-01T00:00:00.000Z"),
        description: "Fixture summary",
      });
      const data = await list({ search: "Harmless publication" });
      // Fixture UUID is an example; the database assigns the real identity.
      expect({ ok: true, data }).toEqual({
        ...directoryFixture,
        data: {
          ...directoryFixture.data,
          items: directoryFixture.data.items.map((item) => ({
            ...item,
            id: entry.id,
          })),
        },
      });
      const response = await request("cms.delivery.getById", {
        entryId: entry.id,
        fields: "id",
      });
      expect(response.status).toBe(200);
      expect(detailEnvelope.parse(await response.json()).data).toEqual({
        entry: { id: entry.id },
      });
    });
    it("can use both additive folder ordering indexes for bounded summary queries", async () => {
      await db.transaction(async (tx) => {
        // Prove ordering-index compatibility, independent of tiny-fixture costs:
        // normal plans may correctly prefer a date index plus a small title sort.
        // These transaction-local diagnostics do not tune the production planner.
        await tx.execute(sql`set local enable_seqscan = off`);
        await tx.execute(sql`set local enable_sort = off`);
        for (const sortBy of ["publishedAt", "title"]) {
          const query = buildDeliveryListQuery({
            ...ContentDeliveryDirectoryPayloadSchema.parse({
              directoryId: folder,
              sortBy,
            }),
            workspaceId,
          });
          const plan = await tx.execute(
            sql`explain (format json) ${query.getSQL()}`,
          );
          const text = JSON.stringify(plan);
          expect(text).toContain(
            sortBy === "title"
              ? "content_entries_delivery_title_idx"
              : "content_entries_delivery_date_idx",
          );
          expect(text).toContain("Limit");
        }
      });
    });
    it("search treats wildcard and SQL-looking characters literally", async () => {
      const special = await create("Literal %_\\' fixture");
      await create("Literal ordinary fixture");
      expect(
        (await list({ search: "%_\\'" })).items.map((entry) => entry.id),
      ).toEqual([special.id]);
      expect((await list({ search: "' OR true --" })).items).toEqual([]);
      const description = await create("Search description", {
        description: "Distinct published description",
      });
      expect(
        (await list({ search: "Distinct published" })).items.map(
          (entry) => entry.id,
        ),
      ).toEqual([description.id]);
    });
    it("gates live status, deletion, due times, identity and workspace without fallback", async () => {
      for (const status of ["draft", "scheduled", "archived"] as const) {
        const entry = await create(`Hidden ${status}`);
        await setEntryStatusByIdAndWorkspace({
          entryId: entry.id,
          workspaceId,
          status: status === "scheduled" ? "draft" : status,
        });
        const response = await request("cms.delivery.getById", {
          entryId: entry.id,
        });
        expect(response.status).toBe(404);
        unavailable.parse(await response.json());
      }
      const future = await create("Hidden future", {
        at: new Date("2099-01-01"),
      });
      const deleted = await create("Hidden deleted");
      await db
        .update(contentEntries)
        .set({ deletedAt: new Date() })
        .where(eq(contentEntries.id, deleted.id));
      const missing = await create("Hidden missing snapshot");
      await db
        .update(contentEntries)
        .set({ publishedSnapshot: null })
        .where(eq(contentEntries.id, missing.id));
      const wrongId = await create("Hidden identity mismatch");
      await db
        .update(contentEntries)
        .set({
          publishedSnapshot: sql`jsonb_set(${contentEntries.publishedSnapshot}, '{entry,id}', to_jsonb(${crypto.randomUUID()}::text))`,
        })
        .where(eq(contentEntries.id, wrongId.id));
      // Even a matching digest must not substitute another row identity.
      await db
        .update(contentEntries)
        .set({
          publishedSnapshotDigest: sql`'v1:' || encode(sha256(convert_to(${contentEntries.publishedSnapshot}::text, 'UTF8')), 'hex')`,
        })
        .where(eq(contentEntries.id, wrongId.id));
      const mismatched = await create("Hidden time mismatch");
      await db
        .update(contentEntries)
        .set({ publishedAt: new Date("2019-01-01") })
        .where(eq(contentEntries.id, mismatched.id));
      for (const entry of [future, deleted, mismatched, missing, wrongId]) {
        const response = await request("cms.delivery.getById", {
          entryId: entry.id,
        });
        expect(response.status).toBe(404);
        unavailable.parse(await response.json());
      }
      expect((await list({ search: "Hidden" })).items).toEqual([]);
      expect((await list({}, foreignWorkspace)).items).toEqual([]);
      const live = await create("Live foreign boundary");
      const foreign = await request(
        "cms.delivery.getById",
        { entryId: live.id },
        foreignWorkspace,
      );
      expect(foreign.status).toBe(404);
      unavailable.parse(await foreign.json());
      const scheduled = await create("Due promotion", {
        status: "scheduled",
        at: new Date("2099-01-01"),
      });
      await db
        .update(contentEntries)
        .set({ publishedAt: new Date("2020-01-01") })
        .where(eq(contentEntries.id, scheduled.id));
      await publishScheduledEntryByIdAndWorkspace({
        entryId: scheduled.id,
        workspaceId,
      });
      expect((await list({ search: "Due promotion" })).items).toHaveLength(1);
    });
    it("retains internal authentication and actor boundaries and rejects unsupported inputs", async () => {
      for (const payload of [
        { directoryId: null },
        { directoryId: folder, fields: "body" },
        { directoryId: folder, status: "draft" },
        { directoryId: folder, preview: true },
        { directoryId: folder, limit: 101 },
      ]) {
        expect(
          (await request("cms.delivery.listByDirectory", payload)).status,
        ).toBe(400);
      }
      expect(
        (
          await request("cms.delivery.listByDirectory", {
            directoryId: folder,
            workspaceId: foreignWorkspace,
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await request(
            "cms.delivery.listByDirectory",
            { directoryId: folder },
            workspaceId,
            { "X-Internal-Service-Token": "invalid" },
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await request(
            "cms.delivery.listByDirectory",
            { directoryId: folder },
            workspaceId,
            { "X-XS-API-Key-Prefix": "invalid" },
          )
        ).status,
      ).toBe(400);
      expect(
        (
          await request(
            "cms.delivery.listByDirectory",
            { directoryId: folder },
            workspaceId,
            { "X-XS-Actor-Type": "user", "X-XS-User-Id": "" },
          )
        ).status,
      ).toBe(401);
      const empty = await list({ directoryId: crypto.randomUUID() });
      expect(empty).toEqual({
        items: [],
        page: { limit: 20, offset: 0, hasMore: false },
      });
    });
  },
);
