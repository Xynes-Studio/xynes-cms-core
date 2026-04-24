import { describe, it, expect, beforeEach, vi } from "bun:test";
import type { ActionContext } from "../../src/actions/types";
import {
  ContentTypeNotFoundError,
  ValidationError,
} from "../../src/actions/errors";
import {
  ContentCreatePayloadSchema,
  createHandleContentCreate,
} from "../../src/actions/handlers/content-create.handler";

const createEntry = vi.fn();
const findContentTypeWithTemplateByIdAndWorkspace = vi.fn();

const deps = {
  createEntry,
  findContentTypeWithTemplateByIdAndWorkspace,
};

const handleContentCreate = createHandleContentCreate(deps as any);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("cms.content.create schema", () => {
  it("accepts minimal valid payload and passthrough data fields", () => {
    const payload = {
      contentTypeId: crypto.randomUUID(),
      documentId: null,
      publishNow: true,
      data: {
        slug: "some-slug",
        title: "Some title",
        customField: "custom",
      },
    };

    const result = ContentCreatePayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect((result.data as any).data.customField).toBe("custom");
  });

  it("rejects forbidden prototype-pollution keys in data", () => {
    // Use JSON.parse to simulate request JSON parsing, where "__proto__" becomes an own property.
    const payload = {
      contentTypeId: crypto.randomUUID(),
      data: JSON.parse(
        '{"slug":"s","title":"t","__proto__":{"polluted":true}}',
      ),
    };

    const result = ContentCreatePayloadSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it("rejects forbidden keys like constructor/prototype in data", () => {
    const payload = {
      contentTypeId: crypto.randomUUID(),
      data: JSON.parse('{"slug":"s","title":"t","constructor":{"x":1}}'),
    };

    const result = ContentCreatePayloadSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it("rejects missing slug/title", () => {
    const payloadMissingSlug = {
      contentTypeId: crypto.randomUUID(),
      data: { title: "T" },
    };
    expect(
      ContentCreatePayloadSchema.safeParse(payloadMissingSlug).success,
    ).toBe(false);

    const payloadMissingTitle = {
      contentTypeId: crypto.randomUUID(),
      data: { slug: "s" },
    };
    expect(
      ContentCreatePayloadSchema.safeParse(payloadMissingTitle).success,
    ).toBe(false);
  });
});

describe("cms.content.create handler", () => {
  const ctx: ActionContext = {
    workspaceId: crypto.randomUUID(),
    userId: crypto.randomUUID(),
  };

  it("creates a draft entry for a valid content type", async () => {
    const contentTypeId = crypto.randomUUID();

    findContentTypeWithTemplateByIdAndWorkspace.mockResolvedValue({
      id: contentTypeId,
      workspaceId: ctx.workspaceId,
      templateKey: "blog_post",
      name: "Blog",
      slug: "blog",
      routeSegment: "blog",
      config: {},
      templateId: crypto.randomUUID(),
      template: {
        id: crypto.randomUUID(),
        key: "blog_post",
        name: "Blog Post",
        fieldsSchema: {
          slug: { type: "string", required: true },
          title: { type: "string", required: true },
        },
      },
    });

    createEntry.mockResolvedValue({
      id: crypto.randomUUID(),
      workspaceId: ctx.workspaceId,
      contentTypeId,
      documentId: null,
      data: { slug: "some-slug", title: "Some title", custom: "x" },
      status: "draft",
      publishedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await handleContentCreate(
      {
        contentTypeId,
        documentId: null,
        data: { slug: "some-slug", title: "Some title", custom: "x" },
      } as any,
      ctx,
    );

    expect(createEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: ctx.workspaceId,
        contentTypeId,
        status: "draft",
        publishedAt: null,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      }),
    );
    expect(res.entry.routeSegment).toBe("blog");
    expect(res.entry.slug).toBe("some-slug");
    expect(res.entry.data.title).toBe("Some title");
  });

  it("creates a published entry when publishNow is set", async () => {
    const contentTypeId = crypto.randomUUID();
    findContentTypeWithTemplateByIdAndWorkspace.mockResolvedValue({
      id: contentTypeId,
      workspaceId: ctx.workspaceId,
      templateKey: "blog_post",
      name: "Blog",
      slug: "blog",
      routeSegment: "blog",
      config: {},
      templateId: crypto.randomUUID(),
      template: {
        id: crypto.randomUUID(),
        key: "blog_post",
        name: "Blog Post",
        fieldsSchema: {},
      },
    });

    createEntry.mockResolvedValue({
      id: crypto.randomUUID(),
      workspaceId: ctx.workspaceId,
      contentTypeId,
      documentId: null,
      data: { slug: "pub", title: "Pub" },
      status: "published",
      publishedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await handleContentCreate(
      {
        contentTypeId,
        publishNow: true,
        data: { slug: "pub", title: "Pub" },
      } as any,
      ctx,
    );

    expect(res.entry.status).toBe("published");
    expect(res.entry.publishedAt).toBeInstanceOf(Date);
  });

  it("creates a published entry when data.publishedAt is provided", async () => {
    const contentTypeId = crypto.randomUUID();
    findContentTypeWithTemplateByIdAndWorkspace.mockResolvedValue({
      id: contentTypeId,
      workspaceId: ctx.workspaceId,
      templateKey: "blog_post",
      name: "Blog",
      slug: "blog",
      routeSegment: "blog",
      config: {},
      templateId: crypto.randomUUID(),
      template: {
        id: crypto.randomUUID(),
        key: "blog_post",
        name: "Blog Post",
        fieldsSchema: {},
      },
    });

    const publishedAtIso = "2024-01-01T00:00:00.000Z";
    const publishedAtDate = new Date(publishedAtIso);

    createEntry.mockResolvedValue({
      id: crypto.randomUUID(),
      workspaceId: ctx.workspaceId,
      contentTypeId,
      documentId: null,
      data: { slug: "scheduled", title: "Scheduled", publishedAt: publishedAtIso },
      status: "published",
      publishedAt: publishedAtDate,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await handleContentCreate(
      {
        contentTypeId,
        data: { slug: "scheduled", title: "Scheduled", publishedAt: publishedAtIso },
      } as any,
      ctx,
    );

    expect(createEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "published",
        publishedAt: publishedAtDate,
      }),
    );
  });

  it("throws VALIDATION_ERROR when data.publishedAt is invalid", async () => {
    const contentTypeId = crypto.randomUUID();
    findContentTypeWithTemplateByIdAndWorkspace.mockResolvedValue({
      id: contentTypeId,
      workspaceId: ctx.workspaceId,
      templateKey: "blog_post",
      name: "Blog",
      slug: "blog",
      routeSegment: "blog",
      config: {},
      templateId: crypto.randomUUID(),
      template: {
        id: crypto.randomUUID(),
        key: "blog_post",
        name: "Blog Post",
        fieldsSchema: {},
      },
    });

    await expect(
      handleContentCreate(
        {
          contentTypeId,
          data: { slug: "s", title: "t", publishedAt: "not-a-date" },
        } as any,
        ctx,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws CONTENT_TYPE_NOT_FOUND when content type is missing or workspace mismatched", async () => {
    const contentTypeId = crypto.randomUUID();
    findContentTypeWithTemplateByIdAndWorkspace.mockResolvedValue(null);

    await expect(
      handleContentCreate(
        {
          contentTypeId,
          data: { slug: "s", title: "t" },
        } as any,
        ctx,
      ),
    ).rejects.toBeInstanceOf(ContentTypeNotFoundError);
  });

  it("throws VALIDATION_ERROR when routeSegment is empty", async () => {
    const contentTypeId = crypto.randomUUID();
    findContentTypeWithTemplateByIdAndWorkspace.mockResolvedValue({
      id: contentTypeId,
      workspaceId: ctx.workspaceId,
      templateKey: "blog_post",
      name: "Blog",
      slug: "blog",
      routeSegment: "",
      config: {},
      templateId: crypto.randomUUID(),
      template: {
        id: crypto.randomUUID(),
        key: "blog_post",
        name: "Blog Post",
        fieldsSchema: {},
      },
    });

    await expect(
      handleContentCreate(
        { contentTypeId, data: { slug: "s", title: "t" } } as any,
        ctx,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws VALIDATION_ERROR when template is missing", async () => {
    const contentTypeId = crypto.randomUUID();
    findContentTypeWithTemplateByIdAndWorkspace.mockResolvedValue({
      id: contentTypeId,
      workspaceId: ctx.workspaceId,
      templateKey: "blog_post",
      name: "Blog",
      slug: "blog",
      routeSegment: "blog",
      config: {},
      templateId: null,
      template: null,
    });

    await expect(
      handleContentCreate(
        { contentTypeId, data: { slug: "s", title: "t" } } as any,
        ctx,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
