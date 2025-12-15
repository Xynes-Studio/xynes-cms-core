import { describe, expect, it, mock } from "bun:test";
import { ContentTypeTemplateMismatchError } from "../../src/actions/errors";
import {
  EventCreatePayloadSchema,
  makeEventCreateHandler,
} from "../../src/actions/handlers/event.handler";

describe("cms.event.create (Unit)", () => {
  it("validates payload schema (strict, supports nullable documentId)", async () => {
    const valid = EventCreatePayloadSchema.safeParse({
      contentTypeId: "550e8400-e29b-41d4-a716-446655440000",
      documentId: null,
      publishNow: true,
      data: {
        slug: "event-1",
        title: "Event 1",
        eventDate: "2024-01-01T10:00:00Z",
      },
    });
    expect(valid.success).toBe(true);

    const rejectsExtraField = EventCreatePayloadSchema.safeParse({
      contentTypeId: "550e8400-e29b-41d4-a716-446655440000",
      data: {
        slug: "event-2",
        title: "Event 2",
        startDate: "2024-01-01T10:00:00Z",
      },
    });
    expect(rejectsExtraField.success).toBe(false);
  });

  it("creates a published event entry (happy path)", async () => {
    const findContentTypeByIdAndWorkspace = mock(async () => ({
      id: "ct-event",
      workspaceId: "ws-1",
      templateKey: "event",
      name: "Event",
      slug: "event",
      config: {},
    }));

    const createEntry = mock(async (input: any) => ({
      id: "entry-1",
      workspaceId: input.workspaceId,
      contentTypeId: input.contentTypeId,
      documentId: input.documentId ?? null,
      data: input.data,
      status: input.status ?? "draft",
      publishedAt: input.publishedAt ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    const handler = makeEventCreateHandler({
      findContentTypeByIdAndWorkspace: findContentTypeByIdAndWorkspace as any,
      createEntry: createEntry as any,
      now: () => new Date("2024-01-01T00:00:00.000Z"),
    });

    const result = await handler(
      {
        contentTypeId: crypto.randomUUID(),
        publishNow: true,
        data: { slug: "e-1", title: "Event 1" },
      },
      { workspaceId: "ws-1", userId: "u-1" },
    );

    expect(result.entry.slug).toBe("e-1");
    expect(result.entry.status).toBe("published");
    expect(result.entry.publishedAt).toBeInstanceOf(Date);
    expect(createEntry).toHaveBeenCalledTimes(1);
  });

  it("throws a domain error when content type template mismatches", async () => {
    const findContentTypeByIdAndWorkspace = mock(async () => ({
      id: "ct-program",
      workspaceId: "ws-1",
      templateKey: "program",
      name: "Program",
      slug: "program",
      config: {},
    }));

    const createEntry = mock(async (_input: any) => {
      throw new Error("should not be called");
    });

    const handler = makeEventCreateHandler({
      findContentTypeByIdAndWorkspace: findContentTypeByIdAndWorkspace as any,
      createEntry: createEntry as any,
      now: () => new Date("2024-01-01T00:00:00.000Z"),
    });

    await expect(
      handler(
        {
          contentTypeId: crypto.randomUUID(),
          data: { slug: "e-1", title: "Event 1" },
        },
        { workspaceId: "ws-1" },
      ),
    ).rejects.toBeInstanceOf(ContentTypeTemplateMismatchError);
  });
});
