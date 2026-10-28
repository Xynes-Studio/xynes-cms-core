import { signedInit } from "../support/internal-request";
import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { eq } from "drizzle-orm";
import { app } from "../../src/index";
import {
  type IAuthzClient,
  resetAuthzClient,
  setAuthzClient,
} from "../../src/infra/authz";
import { db } from "../../src/infra/db";
import { contentDirectories, contentEntries } from "../../src/infra/db/schema";
import { INTERNAL_SERVICE_TOKEN } from "../support/internal-auth";
import { getIntegrationUserId } from "../support/integration-user";

interface ActionSuccessEnvelope<T> {
  ok: true;
  data: T;
}

interface DirectoryDto {
  id: string;
  parentId: string | null;
}

// Real Postgres: parent_id is text while id is uuid, so the recursive subtree
// delete must compare compatible types (mocked unit tests cannot see this).
describe.skipIf(process.env.RUN_INTEGRATION_TESTS !== "true")(
  "Content Directory Delete Integration",
  () => {
    let workspaceId: string;
    let actorUserId: string;

    async function requestAction(
      actionKey: string,
      payload: Record<string, unknown>,
    ) {
      return app.request(
        "/internal/cms-actions",
        signedInit("/internal/cms-actions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
            "X-Workspace-Id": workspaceId,
            "X-XS-User-Id": actorUserId,
          },
          body: JSON.stringify({ actionKey, payload }),
        }),
      );
    }

    async function createDirectory(name: string, parentId: string | null) {
      const res = await requestAction("cms.content_directories.create", {
        name,
        parentId,
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as ActionSuccessEnvelope<DirectoryDto>;
      return body.data;
    }

    beforeAll(async () => {
      actorUserId = await getIntegrationUserId();
      const authz: IAuthzClient = {
        check: mock(() => Promise.resolve({ allowed: true })),
      };
      setAuthzClient(authz);
      workspaceId = crypto.randomUUID();
    });

    afterAll(async () => {
      await db
        .delete(contentEntries)
        .where(eq(contentEntries.workspaceId, workspaceId));
      await db
        .delete(contentDirectories)
        .where(eq(contentDirectories.workspaceId, workspaceId));
      resetAuthzClient();
    });

    it("deletes a leaf directory", async () => {
      const leaf = await createDirectory(`Leaf ${crypto.randomUUID()}`, null);

      const res = await requestAction("cms.content_directories.delete", {
        directoryId: leaf.id,
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as ActionSuccessEnvelope<{
        deletedCount: number;
      }>;
      expect(body.data.deletedCount).toBe(1);
    });

    it("deletes a directory subtree and detaches its entries", async () => {
      const root = await createDirectory(`Root ${crypto.randomUUID()}`, null);
      const child = await createDirectory("Child", root.id);
      expect(child.parentId).toBe(root.id);
      const grandchild = await createDirectory("Grandchild", child.id);

      const entryRes = await requestAction("cms.entry.create", {
        directoryId: grandchild.id,
        title: `Subtree Entry ${crypto.randomUUID()}`,
      });
      expect(entryRes.status).toBe(200);
      const entryBody = (await entryRes.json()) as ActionSuccessEnvelope<{
        entry: { id: string };
      }>;

      const res = await requestAction("cms.content_directories.delete", {
        directoryId: root.id,
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as ActionSuccessEnvelope<{
        deletedCount: number;
      }>;
      expect(body.data.deletedCount).toBe(3);

      const remaining = await db
        .select({ id: contentDirectories.id })
        .from(contentDirectories)
        .where(eq(contentDirectories.workspaceId, workspaceId));
      expect(remaining).toEqual([]);

      const [entry] = await db
        .select({ directoryId: contentEntries.directoryId })
        .from(contentEntries)
        .where(eq(contentEntries.id, entryBody.data.entry.id));
      expect(entry?.directoryId).toBeNull();
    });
  },
);
