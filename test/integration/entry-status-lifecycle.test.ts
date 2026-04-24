import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { and, eq } from "drizzle-orm";
import { app } from "../../src/index";
import {
  type IAuthzClient,
  resetAuthzClient,
  setAuthzClient,
} from "../../src/infra/authz";
import { db } from "../../src/infra/db";
import { contentEntries, contentTypes } from "../../src/infra/db/schema";
import { runSeed } from "../../src/infra/db/seeders";
import { createScheduledEntryPublisher } from "../../src/scheduling/scheduled-entry-publisher";
import { INTERNAL_SERVICE_TOKEN } from "../support/internal-auth";

interface EntryActionDto {
  id: string;
  status: string;
  publishedAt: string | null;
}

interface ActionSuccessEnvelope<T> {
  ok: true;
  data: T;
}

interface ActionErrorEnvelope {
  ok: false;
  error: {
    code: string;
  };
}

describe.skipIf(process.env.RUN_INTEGRATION_TESTS !== "true")(
  "Directory-First Entry Status Lifecycle Integration",
  () => {
    let workspaceId: string;
    let blogContentTypeId: string;
    let mockAuthzClient: IAuthzClient;

    async function requestAction(
      actionKey: string,
      payload: Record<string, unknown>,
      userId = "5e4c9542-72bc-4781-9f0f-8a21465de7de",
    ) {
      return app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
          "X-Workspace-Id": workspaceId,
          "X-XS-User-Id": userId,
        },
        body: JSON.stringify({
          actionKey,
          payload,
        }),
      });
    }

    beforeAll(async () => {
      mockAuthzClient = {
        check: mock(() => Promise.resolve({ allowed: true })),
      };
      setAuthzClient(mockAuthzClient);

      workspaceId = crypto.randomUUID();
      await runSeed(db, workspaceId);

      const [blogType] = await db
        .select()
        .from(contentTypes)
        .where(
          and(
            eq(contentTypes.workspaceId, workspaceId),
            eq(contentTypes.templateKey, "blog_post"),
          ),
        )
        .limit(1);

      if (!blogType) {
        throw new Error("Seeded blog_post content type not found");
      }

      blogContentTypeId = blogType.id;
    });

    afterAll(async () => {
      await db
        .delete(contentEntries)
        .where(eq(contentEntries.workspaceId, workspaceId));
      await db
        .delete(contentTypes)
        .where(eq(contentTypes.workspaceId, workspaceId));
      resetAuthzClient();
    });

    it("supports create -> publish -> draft -> archive through internal actions", async () => {
      const title = `Lifecycle Entry ${crypto.randomUUID()}`;

      const createRes = await requestAction("cms.entry.create", {
        title,
        description: "Lifecycle test entry",
      });
      expect(createRes.status).toBe(200);

      const createBody = (await createRes.json()) as ActionSuccessEnvelope<{
        entry: EntryActionDto;
      }>;
      const entryId = createBody.data.entry.id;
      expect(createBody.data.entry.status).toBe("draft");

      const publishRes = await requestAction("cms.entry.publish", {
        entryId,
      });
      expect(publishRes.status).toBe(200);
      const publishBody = (await publishRes.json()) as ActionSuccessEnvelope<{
        entry: EntryActionDto;
      }>;
      expect(publishBody.data.entry.status).toBe("published");
      expect(publishBody.data.entry.publishedAt).toBeTruthy();

      const draftRes = await requestAction("cms.entry.status.set", {
        entryId,
        status: "draft",
      });
      expect(draftRes.status).toBe(200);
      const draftBody = (await draftRes.json()) as ActionSuccessEnvelope<{
        entry: EntryActionDto;
      }>;
      expect(draftBody.data.entry.status).toBe("draft");
      expect(draftBody.data.entry.publishedAt).toBeNull();

      const archiveRes = await requestAction("cms.entry.status.set", {
        entryId,
        status: "archived",
      });
      expect(archiveRes.status).toBe(200);
      const archiveBody = (await archiveRes.json()) as ActionSuccessEnvelope<{
        entry: EntryActionDto;
      }>;
      expect(archiveBody.data.entry.status).toBe("archived");
      expect(archiveBody.data.entry.publishedAt).toBeNull();

      const [stored] = await db
        .select()
        .from(contentEntries)
        .where(
          and(
            eq(contentEntries.id, entryId),
            eq(contentEntries.workspaceId, workspaceId),
          ),
        )
        .limit(1);
      expect(stored?.status).toBe("archived");
      expect(stored?.publishedAt).toBeNull();
    });

    it("supports scheduling and keeps scheduled entries out of public published reads", async () => {
      const title = `Scheduled Entry ${crypto.randomUUID()}`;
      const expectedSlug = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      const publishAt = "2099-02-27T12:00:00.000Z";

      const createRes = await requestAction("cms.entry.create", {
        title,
        description: "Schedule test entry",
      });
      expect(createRes.status).toBe(200);
      const createBody = (await createRes.json()) as ActionSuccessEnvelope<{
        entry: EntryActionDto;
      }>;
      const entryId = createBody.data.entry.id;

      const scheduleRes = await requestAction("cms.entry.status.set", {
        entryId,
        status: "scheduled",
        publishAt,
      });
      expect(scheduleRes.status).toBe(200);
      const scheduleBody = (await scheduleRes.json()) as ActionSuccessEnvelope<{
        entry: EntryActionDto;
      }>;
      expect(scheduleBody.data.entry.status).toBe("scheduled");
      expect(scheduleBody.data.entry.publishedAt).toBe(publishAt);

      const listRes = await requestAction("cms.entry.listByDirectory", {
        status: "scheduled",
      });
      expect(listRes.status).toBe(200);
      const listBody = (await listRes.json()) as ActionSuccessEnvelope<{
        items: Array<{ id: string }>;
      }>;
      const scheduledIds = listBody.data.items.map((item) => item.id);
      expect(scheduledIds).toContain(entryId);

      const publicRes = await requestAction(
        "cms.content.listPublished",
        {
          routeSegment: "blog",
          limit: 20,
          offset: 0,
        },
        "public-reader",
      );
      expect(publicRes.status).toBe(200);
      const publicBody = (await publicRes.json()) as ActionSuccessEnvelope<{
        entries: Array<{ slug: string }>;
      }>;
      const publicSlugs = publicBody.data.entries.map((entry) => entry.slug);
      expect(publicSlugs).not.toContain(expectedSlug);

      const [stored] = await db
        .select()
        .from(contentEntries)
        .where(
          and(
            eq(contentEntries.id, entryId),
            eq(contentEntries.workspaceId, workspaceId),
            eq(contentEntries.contentTypeId, blogContentTypeId),
          ),
        )
        .limit(1);
      expect(stored?.status).toBe("scheduled");
      expect(stored?.publishedAt?.toISOString()).toBe(publishAt);
    });

    it("rejects scheduling an entry that is already published", async () => {
      const createRes = await requestAction("cms.entry.create", {
        title: `Published Schedule Rejection ${crypto.randomUUID()}`,
        description: "Published entries require a draft revision before scheduling",
      });
      expect(createRes.status).toBe(200);
      const createBody = (await createRes.json()) as ActionSuccessEnvelope<{
        entry: EntryActionDto;
      }>;
      const entryId = createBody.data.entry.id;

      const publishRes = await requestAction("cms.entry.publish", { entryId });
      expect(publishRes.status).toBe(200);

      const scheduleRes = await requestAction("cms.entry.status.set", {
        entryId,
        status: "scheduled",
        publishAt: "2099-02-27T12:00:00.000Z",
      });
      expect(scheduleRes.status).toBe(400);

      const [stored] = await db
        .select()
        .from(contentEntries)
        .where(
          and(
            eq(contentEntries.id, entryId),
            eq(contentEntries.workspaceId, workspaceId),
          ),
        )
        .limit(1);
      expect(stored?.status).toBe("published");
    });

    it("rejects scheduling without publishAt via internal actions", async () => {
      const createRes = await requestAction("cms.entry.create", {
        title: `Validation Entry ${crypto.randomUUID()}`,
      });
      expect(createRes.status).toBe(200);
      const createBody = (await createRes.json()) as ActionSuccessEnvelope<{
        entry: EntryActionDto;
      }>;

      const invalidRes = await requestAction("cms.entry.status.set", {
        entryId: createBody.data.entry.id,
        status: "scheduled",
      });
      expect(invalidRes.status).toBe(400);

      const invalidBody = (await invalidRes.json()) as ActionErrorEnvelope;
      expect(invalidBody.ok).toBe(false);
      expect(invalidBody.error.code).toBe("VALIDATION_ERROR");
    });

    it("publishes due scheduled entries when the scheduler runs", async () => {
      const title = `Due Scheduled Entry ${crypto.randomUUID()}`;

      const createRes = await requestAction("cms.entry.create", {
        title,
        description: "Due schedule test entry",
      });
      expect(createRes.status).toBe(200);
      const createBody = (await createRes.json()) as ActionSuccessEnvelope<{
        entry: EntryActionDto;
      }>;
      const entryId = createBody.data.entry.id;

      const scheduleRes = await requestAction("cms.entry.status.set", {
        entryId,
        status: "scheduled",
        publishAt: "2099-02-27T12:00:00.000Z",
      });
      expect(scheduleRes.status).toBe(200);

      const scheduledAt = new Date("2026-02-26T11:55:00.000Z");
      await db
        .update(contentEntries)
        .set({
          status: "scheduled",
          publishedAt: scheduledAt,
        })
        .where(
          and(
            eq(contentEntries.id, entryId),
            eq(contentEntries.workspaceId, workspaceId),
          ),
        );

      const scheduler = createScheduledEntryPublisher();
      await scheduler.runNow();

      const [stored] = await db
        .select()
        .from(contentEntries)
        .where(
          and(
            eq(contentEntries.id, entryId),
            eq(contentEntries.workspaceId, workspaceId),
          ),
        )
        .limit(1);

      expect(stored?.status).toBe("published");
      expect(stored?.publishedAt?.toISOString()).toBe(
        scheduledAt.toISOString(),
      );
    });
  },
);
