import { z } from "zod";

export interface SmokeDependencies {
  preflight(): Promise<void>;
  action(key: string, payload: Record<string, unknown>): Promise<unknown>;
  inspect(entryId: string): Promise<unknown>;
  report(label: string): void;
}
export class SmokeRequestError extends Error {
  constructor(
    action: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(`${action}: HTTP ${status} ${code}`);
  }
}
const entryResponse = z.object({
  entry: z.object({
    id: z.string().uuid(),
    status: z.string(),
    deliveryState: z.string(),
  }),
});
const snapshotResponse = z.object({
  version: z.literal(1),
  entry: z.object({ title: z.string() }),
});
const emptyBody = { root: { type: "root", version: 1, children: [] } };

function check(condition: boolean, label: string): asserts condition {
  if (!condition) throw new Error(`Smoke assertion failed: ${label}`);
}

// Writes only one uniquely named fixture and soft-deletes it even after a failure.
export async function runPublicationSmoke(
  deps: SmokeDependencies,
): Promise<void> {
  await deps.preflight();
  const listing = await deps.action("cms.entry.listByDirectory", {
    directoryId: null,
    limit: 1,
    offset: 0,
  });
  check(
    z.object({ items: z.array(z.unknown()) }).safeParse(listing).success,
    "authoring list",
  );
  deps.report("authoring list and migration 0008");
  const title = `Publication smoke ${crypto.randomUUID()}`;
  const created = entryResponse.parse(
    await deps.action("cms.entry.create", {
      title,
      body: emptyBody,
      publishNow: false,
    }),
  );
  const entryId = created.entry.id;
  try {
    check(
      created.entry.deliveryState === "unpublished",
      "draft is unpublished",
    );
    const published = entryResponse.parse(
      await deps.action("cms.entry.publish", { entryId }),
    );
    check(
      published.entry.status === "published" &&
        published.entry.deliveryState === "available",
      "published delivery state",
    );
    const firstSnapshot = await deps.inspect(entryId);
    check(
      snapshotResponse.parse(firstSnapshot).entry.title === title,
      "published snapshot A",
    );
    deps.report("publish captures snapshot A");

    await deps.action("cms.entry.update", {
      entryId,
      title: `${title} edited`,
    });
    check(
      JSON.stringify(await deps.inspect(entryId)) ===
        JSON.stringify(firstSnapshot),
      "draft save must preserve snapshot A",
    );
    deps.report("draft edit preserves the last publication");
    await deps.action("cms.entry.publish", { entryId });
    const secondSnapshot = await deps.inspect(entryId);
    check(
      snapshotResponse.parse(secondSnapshot).entry.title === `${title} edited`,
      "republish captures B",
    );
    deps.report("republish captures snapshot B");

    await deps.action("cms.entry.update", {
      entryId,
      body: {
        root: {
          type: "root",
          version: 1,
          children: [
            {
              type: "image-block",
              version: 1,
              src: "https://example.invalid/image?access_token=smoke",
            },
          ],
        },
      },
    });
    let rejected = false;
    try {
      await deps.action("cms.entry.publish", { entryId });
    } catch (error) {
      if (
        !(error instanceof SmokeRequestError) ||
        error.status !== 400 ||
        error.code !== "PUBLICATION_INVALID"
      )
        throw error;
      rejected = true;
    }
    check(rejected, "credential-bearing publication must be rejected");
    check(
      JSON.stringify(await deps.inspect(entryId)) ===
        JSON.stringify(secondSnapshot),
      "invalid publication must preserve snapshot B",
    );
    deps.report("invalid publication is rejected atomically");

    await deps.action("cms.entry.update", {
      entryId,
      title: `${title} repaired`,
      body: emptyBody,
    });
    const repaired = entryResponse.parse(
      await deps.action("cms.entry.status.set", {
        entryId,
        status: "published",
      }),
    );
    check(
      repaired.entry.deliveryState === "available" &&
        snapshotResponse.parse(await deps.inspect(entryId)).entry.title ===
          `${title} repaired`,
      "status.set publishes repaired content",
    );
    deps.report("repair and status.set publication");
    for (const status of ["draft", "scheduled", "archived"]) {
      const response = entryResponse.parse(
        await deps.action("cms.entry.status.set", {
          entryId,
          status,
          ...(status === "scheduled"
            ? { publishAt: "2099-01-01T00:00:00.000Z" }
            : {}),
        }),
      );
      check(
        response.entry.status === status &&
          response.entry.deliveryState === "unpublished",
        `${status} cannot deliver`,
      );
      deps.report(`${status} delivery gate`);
    }
  } finally {
    const deleted = await deps.action("cms.entry.delete", { entryId });
    check(
      z.object({ success: z.literal(true) }).safeParse(deleted).success,
      `cleanup failed for smoke entry ${entryId}`,
    );
    deps.report("smoke fixture soft-deleted");
  }
}

export function createPublicationSmokeClient(
  options: {
    url: string;
    token: string;
    workspaceId: string;
    userId: string;
    timeoutMs: number;
  },
  request: (request: Request) => Promise<Response> = fetch,
): SmokeDependencies["action"] {
  return async (key, payload) => {
    let response: Response;
    let body: unknown;
    try {
      response = await request(
        new Request(`${options.url.replace(/\/$/, "")}/internal/cms-actions`, {
          method: "POST",
          signal: AbortSignal.timeout(options.timeoutMs),
          headers: {
            "Content-Type": "application/json",
            "X-Internal-Service-Token": options.token,
            "X-Workspace-Id": options.workspaceId,
            "X-XS-User-Id": options.userId,
          },
          body: JSON.stringify({ actionKey: key, payload }),
        }),
      );
      body = await response.json();
    } catch {
      throw new Error(`${key}: request failed or timed out (response omitted)`);
    }
    if (!response.ok) {
      const result = z
        .object({
          error: z.object({
            code: z.enum(["PUBLICATION_INVALID", "PUBLICATION_TOO_LARGE"]),
          }),
        })
        .safeParse(body);
      throw new SmokeRequestError(
        key,
        response.status,
        result.success ? result.data.error.code : "FAILED",
      );
    }
    const result = z
      .object({ ok: z.literal(true), data: z.record(z.string(), z.unknown()) })
      .safeParse(body);
    if (!result.success)
      throw new Error(`${key}: invalid action envelope (response omitted)`);
    return result.data.data;
  };
}
