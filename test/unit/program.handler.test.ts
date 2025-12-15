import { describe, expect, it, mock } from "bun:test";
import { ContentTypeTemplateMismatchError } from "../../src/actions/errors";
import {
  ProgramCreatePayloadSchema,
  makeProgramCreateHandler,
} from "../../src/actions/handlers/program.handler";

describe("cms.program.create (Unit)", () => {
  it("validates payload schema (strict, supports nullable documentId)", async () => {
    const valid = ProgramCreatePayloadSchema.safeParse({
      contentTypeId: "550e8400-e29b-41d4-a716-446655440000",
      documentId: null,
      data: {
        slug: "program-1",
        title: "Program 1",
        startDate: "2024-01-01T10:00:00Z",
        endDate: "2024-01-01T11:00:00Z",
        location: "Somewhere",
      },
    });
    expect(valid.success).toBe(true);

    const rejectsExtraField = ProgramCreatePayloadSchema.safeParse({
      contentTypeId: "550e8400-e29b-41d4-a716-446655440000",
      data: {
        slug: "program-2",
        title: "Program 2",
        eventDate: "2024-01-01T10:00:00Z",
      },
    });
    expect(rejectsExtraField.success).toBe(false);
  });

  it("creates a draft program entry (happy path)", async () => {
    const findContentTypeByIdAndWorkspace = mock(async () => ({
      id: "ct-program",
      workspaceId: "ws-1",
      templateKey: "program",
      name: "Program",
      slug: "program",
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

    const handler = makeProgramCreateHandler({
      findContentTypeByIdAndWorkspace: findContentTypeByIdAndWorkspace as any,
      createEntry: createEntry as any,
      now: () => new Date("2024-01-01T00:00:00.000Z"),
    });

    const result = await handler(
      {
        contentTypeId: crypto.randomUUID(),
        publishNow: false,
        data: { slug: "p-1", title: "Program 1" },
      },
      { workspaceId: "ws-1", userId: "u-1" },
    );

    expect(result.entry.slug).toBe("p-1");
    expect(result.entry.status).toBe("draft");
    expect(result.entry.publishedAt).toBeNull();
    expect(createEntry).toHaveBeenCalledTimes(1);
  });

  it("throws a domain error when content type template mismatches", async () => {
    const findContentTypeByIdAndWorkspace = mock(async () => ({
      id: "ct-event",
      workspaceId: "ws-1",
      templateKey: "event",
      name: "Event",
      slug: "event",
      config: {},
    }));

    const createEntry = mock(async (_input: any) => {
      throw new Error("should not be called");
    });

    const handler = makeProgramCreateHandler({
      findContentTypeByIdAndWorkspace: findContentTypeByIdAndWorkspace as any,
      createEntry: createEntry as any,
      now: () => new Date("2024-01-01T00:00:00.000Z"),
    });

    await expect(
      handler(
        {
          contentTypeId: crypto.randomUUID(),
          data: { slug: "p-1", title: "Program 1" },
        },
        { workspaceId: "ws-1" },
      ),
    ).rejects.toBeInstanceOf(ContentTypeTemplateMismatchError);
  });
});
