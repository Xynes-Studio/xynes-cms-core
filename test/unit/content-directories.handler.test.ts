import { describe, expect, it } from "bun:test";
import { ValidationError } from "../../src/actions/errors";
import {
  ContentDirectoriesCreatePayloadSchema,
  ContentDirectoriesListForWorkspacePayloadSchema,
  createHandleContentDirectoriesCreate,
  createHandleContentDirectoriesListForWorkspace,
} from "../../src/actions/handlers/content-directories.handler";

describe("cms.content_directories.*", () => {
  describe("ContentDirectoriesListForWorkspacePayloadSchema", () => {
    it("accepts empty payload and rejects unknown fields", () => {
      expect(
        ContentDirectoriesListForWorkspacePayloadSchema.safeParse({}).success,
      ).toBe(true);
      expect(
        ContentDirectoriesListForWorkspacePayloadSchema.safeParse({
          workspaceId: "forged",
        }).success,
      ).toBe(false);
    });
  });

  describe("ContentDirectoriesCreatePayloadSchema", () => {
    it("accepts name + optional parentId and rejects unknown fields", () => {
      expect(
        ContentDirectoriesCreatePayloadSchema.safeParse({
          name: "Docs",
        }).success,
      ).toBe(true);

      expect(
        ContentDirectoriesCreatePayloadSchema.safeParse({
          name: "Docs",
          parentId: "content-type-11111111-1111-1111-1111-111111111111",
        }).success,
      ).toBe(true);

      expect(
        ContentDirectoriesCreatePayloadSchema.safeParse({
          name: "Docs",
          forged: true,
        }).success,
      ).toBe(false);
    });
  });

  describe("createHandleContentDirectoriesListForWorkspace", () => {
    it("lists directories scoped to ctx.workspaceId", async () => {
      const calls: Array<{ workspaceId: string }> = [];
      const handle = createHandleContentDirectoriesListForWorkspace({
        listContentDirectoriesForWorkspace: async (workspaceId) => {
          calls.push({ workspaceId });
          return [
            {
              id: "dir-1",
              workspaceId,
              parentId: null,
              name: "Docs",
              pathSegment: "docs",
              createdBy: "user-1",
            },
          ];
        },
      });

      const result = await handle({}, { workspaceId: "ws-1" });
      expect(calls).toEqual([{ workspaceId: "ws-1" }]);
      expect(result).toEqual([
        {
          id: "dir-1",
          parentId: null,
          name: "Docs",
          pathSegment: "docs",
        },
      ]);
    });
  });

  describe("createHandleContentDirectoriesCreate", () => {
    it("creates a root directory with normalized pathSegment", async () => {
      const calls: Array<Record<string, unknown>> = [];
      const handle = createHandleContentDirectoriesCreate({
        createContentDirectory: async (input) => {
          calls.push(input as unknown as Record<string, unknown>);
          return {
            id: "dir-1",
            workspaceId: input.workspaceId,
            parentId: input.parentId,
            name: input.name,
            pathSegment: input.pathSegment,
            createdBy: input.createdBy ?? null,
          };
        },
        findContentDirectoryByIdAndWorkspace: async () => null,
        findContentDirectoryByWorkspaceParentAndPathSegment: async () => null,
        findContentTypeByIdAndWorkspace: async () => null,
        findContentTypeByRouteSegmentAndWorkspace: async () => null,
      });

      const result = await handle(
        { name: "  Docs  ", parentId: null },
        { workspaceId: "ws-1", userId: "user-1" },
      );

      expect(calls).toEqual([
        {
          workspaceId: "ws-1",
          parentId: null,
          name: "Docs",
          pathSegment: "docs",
          createdBy: "user-1",
        },
      ]);
      expect(result).toEqual({
        id: "dir-1",
        parentId: null,
        name: "Docs",
        pathSegment: "docs",
      });
    });

    it("allows parent under content-type nodes when content type belongs to workspace", async () => {
      const handle = createHandleContentDirectoriesCreate({
        createContentDirectory: async (input) => ({
          id: "dir-1",
          workspaceId: input.workspaceId,
          parentId: input.parentId,
          name: input.name,
          pathSegment: input.pathSegment,
          createdBy: input.createdBy ?? null,
        }),
        findContentDirectoryByIdAndWorkspace: async () => null,
        findContentDirectoryByWorkspaceParentAndPathSegment: async () => null,
        findContentTypeByIdAndWorkspace: async (_contentTypeId, workspaceId) => ({
          id: "ct-1",
          workspaceId,
          templateKey: "blog_post",
          name: "Blog",
          slug: "blog",
          routeSegment: "blog",
          config: {},
        }),
        findContentTypeByRouteSegmentAndWorkspace: async () => null,
      });

      const result = await handle(
        {
          name: "Drafts",
          parentId: "content-type-11111111-1111-4111-8111-111111111111",
        },
        { workspaceId: "ws-1", userId: "user-1" },
      );

      expect(result).toEqual({
        id: "dir-1",
        parentId: "content-type-11111111-1111-4111-8111-111111111111",
        name: "Drafts",
        pathSegment: "drafts",
      });
    });

    it("rejects ephemeral route-derived parents", async () => {
      const handle = createHandleContentDirectoriesCreate({
        createContentDirectory: async () => {
          throw new Error("should not be called");
        },
        findContentDirectoryByIdAndWorkspace: async () => null,
        findContentDirectoryByWorkspaceParentAndPathSegment: async () => null,
        findContentTypeByIdAndWorkspace: async () => null,
        findContentTypeByRouteSegmentAndWorkspace: async () => null,
      });

      await expect(
        handle(
          { name: "Drafts", parentId: "content-path-tests--guides" },
          { workspaceId: "ws-1", userId: "user-1" },
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("rejects unknown custom-directory parent ids", async () => {
      const handle = createHandleContentDirectoriesCreate({
        createContentDirectory: async () => {
          throw new Error("should not be called");
        },
        findContentDirectoryByIdAndWorkspace: async () => null,
        findContentDirectoryByWorkspaceParentAndPathSegment: async () => null,
        findContentTypeByIdAndWorkspace: async () => null,
        findContentTypeByRouteSegmentAndWorkspace: async () => null,
      });

      await expect(
        handle(
          {
            name: "Drafts",
            parentId: "11111111-1111-1111-1111-111111111111",
          },
          { workspaceId: "ws-1", userId: "user-1" },
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("rejects root pathSegments colliding with content-type route segments", async () => {
      const handle = createHandleContentDirectoriesCreate({
        createContentDirectory: async () => {
          throw new Error("should not be called");
        },
        findContentDirectoryByIdAndWorkspace: async () => null,
        findContentDirectoryByWorkspaceParentAndPathSegment: async () => null,
        findContentTypeByIdAndWorkspace: async () => null,
        findContentTypeByRouteSegmentAndWorkspace: async (routeSegment) =>
          routeSegment === "blog"
            ? {
                id: "ct-1",
                workspaceId: "ws-1",
                templateKey: "blog_post",
                name: "Blog",
                slug: "blog",
                routeSegment: "blog",
                config: {},
              }
            : null,
      });

      await expect(
        handle(
          { name: "Blog", parentId: null },
          { workspaceId: "ws-1", userId: "user-1" },
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("rejects duplicate sibling path segments before attempting insert", async () => {
      const handle = createHandleContentDirectoriesCreate({
        createContentDirectory: async () => {
          throw new Error("should not be called");
        },
        findContentDirectoryByIdAndWorkspace: async () => null,
        findContentDirectoryByWorkspaceParentAndPathSegment: async () => ({
          id: "dir-1",
          workspaceId: "ws-1",
          parentId: null,
          name: "Docs",
          pathSegment: "docs",
          createdBy: null,
        }),
        findContentTypeByIdAndWorkspace: async () => null,
        findContentTypeByRouteSegmentAndWorkspace: async () => null,
      });

      await expect(
        handle(
          { name: "Docs", parentId: null },
          { workspaceId: "ws-1", userId: "user-1" },
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("maps database unique violations to ValidationError for concurrent root creates", async () => {
      const handle = createHandleContentDirectoriesCreate({
        createContentDirectory: async () => {
          const error = new Error("duplicate key value");
          (error as Error & { code: string }).code = "23505";
          throw error;
        },
        findContentDirectoryByIdAndWorkspace: async () => null,
        findContentDirectoryByWorkspaceParentAndPathSegment: async () => null,
        findContentTypeByIdAndWorkspace: async () => null,
        findContentTypeByRouteSegmentAndWorkspace: async () => null,
      });

      await expect(
        handle(
          { name: "Docs", parentId: null },
          { workspaceId: "ws-1", userId: "user-1" },
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });
});
