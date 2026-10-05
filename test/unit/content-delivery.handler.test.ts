import { describe, expect, it } from "bun:test";
import {
  type ContentDeliveryHandlerDeps,
  createHandleDeliveryGetById,
  createHandleDeliveryListByDirectory,
} from "../../src/actions/handlers/content-delivery.handler";
import type { PublicationSnapshot } from "../../src/actions/publication-snapshot";
import {
  ContentDeliveryDirectoryPayloadSchema,
  ContentDeliveryEntryPayloadSchema,
} from "../../src/actions/schemas/content-delivery";

const id = "11111111-1111-4111-8111-111111111111";
const folder = "22222222-2222-4222-8222-222222222222";
const workspaceId = "33333333-3333-4333-8333-333333333333";
const entry: PublicationSnapshot["entry"] = {
  id,
  title: "Harmless publication",
  description: "Fixture summary",
  tags: ["fixture"],
  publishedAt: "2026-10-01T00:00:00.000Z",
  body: { root: { type: "root", version: 1, children: [] } },
};
const ctx = { workspaceId, userId: id };
function deps(): ContentDeliveryHandlerDeps {
  return { list: async () => [entry], get: async () => entry };
}

describe("delivery handlers", () => {
  it("passes the trusted workspace and exact directory scope and returns summary-only JSON", async () => {
    const dependencies = deps();
    dependencies.list = async (options) => {
      expect(options.workspaceId).toBe(workspaceId);
      expect(options.directoryId).toBe(folder);
      return [entry];
    };
    const result = await createHandleDeliveryListByDirectory(dependencies)(
      ContentDeliveryDirectoryPayloadSchema.parse({ directoryId: folder }),
      ctx,
    );
    expect(JSON.parse(JSON.stringify(result))).toEqual({
      items: [
        {
          id,
          title: entry.title,
          description: entry.description,
          tags: entry.tags,
          publishedAt: entry.publishedAt,
        },
      ],
      page: { limit: 20, offset: 0, hasMore: false },
    });
    expect(JSON.stringify(result)).not.toContain("body");
  });
  it("reports truthful bounded paging from a limit+1 result without a total", async () => {
    const dependencies = deps();
    dependencies.list = async () => [entry, { ...entry, id: folder }];
    const result = await createHandleDeliveryListByDirectory(dependencies)(
      ContentDeliveryDirectoryPayloadSchema.parse({
        directoryId: folder,
        limit: 1,
        offset: 9,
        fields: "title",
      }),
      ctx,
    );
    expect(result).toEqual({
      items: [{ id, title: entry.title }],
      page: { limit: 1, offset: 9, hasMore: true },
    });
    dependencies.list = async () => [];
    expect(
      await createHandleDeliveryListByDirectory(dependencies)(
        ContentDeliveryDirectoryPayloadSchema.parse({ directoryId: folder }),
        ctx,
      ),
    ).toEqual({ items: [], page: { limit: 20, offset: 0, hasMore: false } });
  });
  it("projects each supported detail field, always retaining id and never private fields", async () => {
    const dependencies = deps();
    const privateEntry = {
      ...entry,
      workspaceId,
      createdBy: id,
      documentId: folder,
      data: { secret: "private" },
    };
    dependencies.get = async (options) => {
      expect(options.workspaceId).toBe(workspaceId);
      expect(options.entryId).toBe(id);
      return privateEntry;
    };
    for (const field of [
      "id",
      "title",
      "description",
      "tags",
      "publishedAt",
      "body",
    ] as const) {
      const result = await createHandleDeliveryGetById(dependencies)(
        ContentDeliveryEntryPayloadSchema.parse({ entryId: id, fields: field }),
        ctx,
      );
      const expected = field === "id" ? { id } : { id, [field]: entry[field] };
      expect(result).toEqual({ entry: expected });
      expect(JSON.stringify(result)).not.toContain("private");
    }
    dependencies.get = async () => ({ ...entry, body: null });
    expect(
      (
        await createHandleDeliveryGetById(dependencies)(
          ContentDeliveryEntryPayloadSchema.parse({
            entryId: id,
            fields: "body",
          }),
          ctx,
        )
      ).entry.body,
    ).toBeNull();
  });
  it("uses one safe unavailable error with no existence/tenant details", async () => {
    const dependencies = deps();
    dependencies.get = async () => null;
    try {
      await createHandleDeliveryGetById(dependencies)(
        ContentDeliveryEntryPayloadSchema.parse({ entryId: id }),
        ctx,
      );
      throw new Error("Expected unavailable");
    } catch (error) {
      expect(error).toHaveProperty("code", "ENTRY_NOT_FOUND");
      expect(error).toHaveProperty("statusCode", 404);
      expect(error).toHaveProperty("message", "Published content unavailable");
      expect(String(error)).not.toContain(id);
    }
  });
  it("propagates transient errors instead of fabricating an empty feed or unavailable entry", async () => {
    const error = new Error("fixture outage");
    const dependencies = deps();
    dependencies.list = async () => {
      throw error;
    };
    dependencies.get = async () => {
      throw error;
    };
    await expect(
      createHandleDeliveryListByDirectory(dependencies)(
        ContentDeliveryDirectoryPayloadSchema.parse({ directoryId: folder }),
        ctx,
      ),
    ).rejects.toBe(error);
    await expect(
      createHandleDeliveryGetById(dependencies)(
        ContentDeliveryEntryPayloadSchema.parse({ entryId: id }),
        ctx,
      ),
    ).rejects.toBe(error);
  });
  it("fails closed on an invalid workspace before calling the repository", async () => {
    const dependencies = deps();
    dependencies.list = async () => {
      throw new Error("must not query");
    };
    await expect(
      createHandleDeliveryListByDirectory(dependencies)(
        ContentDeliveryDirectoryPayloadSchema.parse({ directoryId: folder }),
        { workspaceId: "" },
      ),
    ).rejects.not.toThrow("must not query");
  });
});
