import { describe, expect, it, mock } from "bun:test";
import {
  ContentTypeNotFoundError,
  EntryNotFoundError,
} from "../../src/actions/errors";
import {
  ProgramGetPublishedBySlugPayloadSchema,
  ProgramListPublishedPayloadSchema,
  makeProgramGetPublishedBySlugHandler,
  makeProgramListPublishedHandler,
} from "../../src/actions/handlers/program.handler";

describe("cms.program.listPublished (Unit)", () => {
  it("validates payload schema (strict, defaults)", async () => {
    const parsed = ProgramListPublishedPayloadSchema.parse({});
    expect(parsed.limit).toBe(10);
    expect(parsed.offset).toBe(0);
    expect(parsed.tag).toBeUndefined();

    expect(ProgramListPublishedPayloadSchema.safeParse({ limit: -1 }).success).toBe(
      false,
    );
    expect(ProgramListPublishedPayloadSchema.safeParse({ offset: -1 }).success).toBe(
      false,
    );
    expect(
      ProgramListPublishedPayloadSchema.safeParse({ limit: 101 }).success,
    ).toBe(false);
    expect(ProgramListPublishedPayloadSchema.safeParse({ tag: "" }).success).toBe(
      false,
    );
    expect(
      ProgramListPublishedPayloadSchema.safeParse({ tag: "   " }).success,
    ).toBe(false);

    const rejectsExtraField = ProgramListPublishedPayloadSchema.safeParse({
      limit: 1,
      extra: true,
    });
    expect(rejectsExtraField.success).toBe(false);
  });

  it("lists published entries for the program template and maps DTO", async () => {
    const findContentTypeByTemplateKey = mock(async () => ({ id: "ct-program" }));
    const listPublishedEntries = mock(async () => [
      {
        id: "entry-1",
        documentId: null,
        publishedAt: new Date("2024-01-01T00:00:00.000Z"),
        data: {
          slug: "p-1",
          title: "Program 1",
          excerpt: "Excerpt",
          tags: ["featured"],
          startDate: "2024-01-01T10:00:00Z",
          endDate: "2024-01-01T11:00:00Z",
          location: "Somewhere",
        },
      },
    ]);

    const handler = makeProgramListPublishedHandler({
      findContentTypeByTemplateKey: findContentTypeByTemplateKey as any,
      listPublishedEntries: listPublishedEntries as any,
    });

    const result = await handler(
      { limit: 5, offset: 10, tag: "featured" },
      { workspaceId: "ws-1" },
    );

    expect(findContentTypeByTemplateKey).toHaveBeenCalledWith("program", "ws-1");
    expect(listPublishedEntries).toHaveBeenCalledWith(
      "ws-1",
      "ct-program",
      5,
      10,
      "featured",
    );

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      id: "entry-1",
      slug: "p-1",
      title: "Program 1",
      excerpt: "Excerpt",
      tags: ["featured"],
      documentId: null,
      data: {
        startDate: "2024-01-01T10:00:00Z",
        endDate: "2024-01-01T11:00:00Z",
        location: "Somewhere",
      },
    });
  });

  it("throws when program content type isn't present in the workspace", async () => {
    const findContentTypeByTemplateKey = mock(async () => null);
    const listPublishedEntries = mock(async () => []);

    const handler = makeProgramListPublishedHandler({
      findContentTypeByTemplateKey: findContentTypeByTemplateKey as any,
      listPublishedEntries: listPublishedEntries as any,
    });

    await expect(handler({}, { workspaceId: "ws-1" })).rejects.toBeInstanceOf(
      ContentTypeNotFoundError,
    );
  });
});

describe("cms.program.getPublishedBySlug (Unit)", () => {
  it("validates payload schema (strict)", async () => {
    const ok = ProgramGetPublishedBySlugPayloadSchema.safeParse({
      slug: "program-1",
    });
    expect(ok.success).toBe(true);

    const rejectsExtraField = ProgramGetPublishedBySlugPayloadSchema.safeParse({
      slug: "program-1",
      extra: true,
    });
    expect(rejectsExtraField.success).toBe(false);
  });

  it("returns a single published entry by slug", async () => {
    const findContentTypeByTemplateKey = mock(async () => ({ id: "ct-program" }));
    const findPublishedEntryBySlug = mock(async () => ({
      id: "entry-1",
      documentId: "doc-1",
      publishedAt: new Date("2024-01-01T00:00:00.000Z"),
      data: {
        slug: "p-1",
        title: "Program 1",
        excerpt: "Excerpt",
        tags: ["featured"],
        startDate: "2024-01-01T10:00:00Z",
        endDate: "2024-01-01T11:00:00Z",
        location: "Somewhere",
      },
    }));

    const handler = makeProgramGetPublishedBySlugHandler({
      findContentTypeByTemplateKey: findContentTypeByTemplateKey as any,
      findPublishedEntryBySlug: findPublishedEntryBySlug as any,
    });

    const result = await handler({ slug: "p-1" }, { workspaceId: "ws-1" });

    expect(findContentTypeByTemplateKey).toHaveBeenCalledWith("program", "ws-1");
    expect(findPublishedEntryBySlug).toHaveBeenCalledWith(
      "ws-1",
      "ct-program",
      "p-1",
    );

    expect(result.entry).toMatchObject({
      id: "entry-1",
      slug: "p-1",
      title: "Program 1",
      excerpt: "Excerpt",
      tags: ["featured"],
      documentId: "doc-1",
      data: {
        startDate: "2024-01-01T10:00:00Z",
        endDate: "2024-01-01T11:00:00Z",
        location: "Somewhere",
      },
    });
  });

  it("throws EntryNotFoundError when slug isn't published", async () => {
    const findContentTypeByTemplateKey = mock(async () => ({ id: "ct-program" }));
    const findPublishedEntryBySlug = mock(async () => null);

    const handler = makeProgramGetPublishedBySlugHandler({
      findContentTypeByTemplateKey: findContentTypeByTemplateKey as any,
      findPublishedEntryBySlug: findPublishedEntryBySlug as any,
    });

    await expect(
      handler({ slug: "missing" }, { workspaceId: "ws-1" }),
    ).rejects.toBeInstanceOf(EntryNotFoundError);
  });
});
