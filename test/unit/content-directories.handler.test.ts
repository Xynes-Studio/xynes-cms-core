import { describe, expect, it } from "bun:test";
import { ValidationError } from "../../src/actions/errors";
import {
  ContentDirectoriesCreatePayloadSchema,
  ContentDirectoriesDeletePayloadSchema,
  ContentDirectoriesListForWorkspacePayloadSchema,
  ContentDirectoriesUpdatePayloadSchema,
  createHandleContentDirectoriesCreate,
  createHandleContentDirectoriesDelete,
  createHandleContentDirectoriesListForWorkspace,
  createHandleContentDirectoriesUpdate,
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
          parentId: "11111111-1111-4111-8111-111111111111",
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

    it("rejects content-type prefixed parent ids", async () => {
      const handle = createHandleContentDirectoriesCreate({
        createContentDirectory: async () => {
          throw new Error("should not be called");
        },
        findContentDirectoryByIdAndWorkspace: async () => null,
        findContentDirectoryByWorkspaceParentAndPathSegment: async () => null,
      });

      await expect(
        handle(
          {
            name: "Drafts",
            parentId: "content-type-11111111-1111-4111-8111-111111111111",
          },
          { workspaceId: "ws-1", userId: "user-1" },
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("rejects ephemeral route-derived parents", async () => {
      const handle = createHandleContentDirectoriesCreate({
        createContentDirectory: async () => {
          throw new Error("should not be called");
        },
        findContentDirectoryByIdAndWorkspace: async () => null,
        findContentDirectoryByWorkspaceParentAndPathSegment: async () => null,
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
      });

      await expect(
        handle(
          { name: "Docs", parentId: null },
          { workspaceId: "ws-1", userId: "user-1" },
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("runs root create validation and insert inside the root-path mutex", async () => {
      const executionOrder: string[] = [];
      const handle = createHandleContentDirectoriesCreate({
        withRootContentDirectoryPathMutex: async ({ workspaceId, pathSegment, run }) => {
          executionOrder.push(`lock:${workspaceId}:${pathSegment}`);
          const result = await run();
          executionOrder.push("unlock");
          return result;
        },
        createContentDirectory: async (input) => {
          executionOrder.push("create-directory");
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
        findContentDirectoryByWorkspaceParentAndPathSegment: async () => {
          executionOrder.push("check-sibling-directory");
          return null;
        },
      });

      await handle(
        { name: "Docs", parentId: null },
        { workspaceId: "ws-1", userId: "user-1" },
      );

      expect(executionOrder).toEqual([
        "lock:ws-1:docs",
        "check-sibling-directory",
        "create-directory",
        "unlock",
      ]);
    });

    it("does not acquire root-path mutex for non-root creates", async () => {
      let lockCalled = false;
      const handle = createHandleContentDirectoriesCreate({
        withRootContentDirectoryPathMutex: async ({ run }) => {
          lockCalled = true;
          return await run();
        },
        createContentDirectory: async (input) => ({
          id: "dir-1",
          workspaceId: input.workspaceId,
          parentId: input.parentId,
          name: input.name,
          pathSegment: input.pathSegment,
          createdBy: input.createdBy ?? null,
        }),
        findContentDirectoryByIdAndWorkspace: async () => ({
          id: "11111111-1111-4111-8111-111111111111",
          workspaceId: "ws-1",
          parentId: null,
          name: "Parent",
          pathSegment: "parent",
          createdBy: null,
        }),
        findContentDirectoryByWorkspaceParentAndPathSegment: async () => null,
      });

      await handle(
        {
          name: "Child",
          parentId: "11111111-1111-4111-8111-111111111111",
        },
        { workspaceId: "ws-1", userId: "user-1" },
      );

      expect(lockCalled).toBe(false);
    });
  });

  describe("ContentDirectoriesUpdatePayloadSchema", () => {
    it("accepts directoryId + name and rejects unknown fields", () => {
      expect(
        ContentDirectoriesUpdatePayloadSchema.safeParse({
          directoryId: "dir-1",
          name: "Docs",
        }).success,
      ).toBe(true);

      expect(
        ContentDirectoriesUpdatePayloadSchema.safeParse({
          directoryId: "dir-1",
          name: "Docs",
          forged: true,
        }).success,
      ).toBe(false);
    });
  });

  describe("createHandleContentDirectoriesUpdate", () => {
    it("updates a directory name with normalized path segment", async () => {
      const calls: Array<Record<string, unknown>> = [];
      const handle = createHandleContentDirectoriesUpdate({
        findContentDirectoryByIdAndWorkspace: async (id, workspaceId) => ({
          id,
          workspaceId,
          parentId: null,
          name: "Docs",
          pathSegment: "docs",
          createdBy: "user-1",
        }),
        findContentDirectoryByWorkspaceParentAndPathSegment: async () => null,
        updateContentDirectoryByIdAndWorkspace: async (input) => {
          calls.push(input as unknown as Record<string, unknown>);
          return {
            id: input.id,
            workspaceId: input.workspaceId,
            parentId: null,
            name: input.name,
            pathSegment: input.pathSegment,
            createdBy: null,
          };
        },
      });

      const result = await handle(
        {
          directoryId: "dir-1",
          name: "Articles",
        },
        { workspaceId: "ws-1", userId: "user-1" },
      );

      expect(calls).toEqual([
        {
          id: "dir-1",
          workspaceId: "ws-1",
          name: "Articles",
          pathSegment: "articles",
        },
      ]);
      expect(result).toEqual({
        id: "dir-1",
        parentId: null,
        name: "Articles",
        pathSegment: "articles",
      });
    });

    it("rejects update when directory does not exist in workspace", async () => {
      const handle = createHandleContentDirectoriesUpdate({
        findContentDirectoryByIdAndWorkspace: async () => null,
        findContentDirectoryByWorkspaceParentAndPathSegment: async () => null,
        updateContentDirectoryByIdAndWorkspace: async () => {
          throw new Error("should not be called");
        },
      });

      await expect(
        handle(
          {
            directoryId: "dir-1",
            name: "Articles",
          },
          { workspaceId: "ws-1", userId: "user-1" },
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("rejects sibling path collisions on update", async () => {
      const handle = createHandleContentDirectoriesUpdate({
        findContentDirectoryByIdAndWorkspace: async (id, workspaceId) => ({
          id,
          workspaceId,
          parentId: null,
          name: "Docs",
          pathSegment: "docs",
          createdBy: "user-1",
        }),
        findContentDirectoryByWorkspaceParentAndPathSegment: async () => ({
          id: "dir-2",
          workspaceId: "ws-1",
          parentId: null,
          name: "Articles",
          pathSegment: "articles",
          createdBy: null,
        }),
        updateContentDirectoryByIdAndWorkspace: async () => {
          throw new Error("should not be called");
        },
      });

      await expect(
        handle(
          {
            directoryId: "dir-1",
            name: "Articles",
          },
          { workspaceId: "ws-1", userId: "user-1" },
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    });

  });

  describe("ContentDirectoriesDeletePayloadSchema", () => {
    it("accepts directoryId and rejects unknown fields", () => {
      expect(
        ContentDirectoriesDeletePayloadSchema.safeParse({
          directoryId: "dir-1",
        }).success,
      ).toBe(true);

      expect(
        ContentDirectoriesDeletePayloadSchema.safeParse({
          directoryId: "dir-1",
          forged: true,
        }).success,
      ).toBe(false);
    });
  });

  describe("createHandleContentDirectoriesDelete", () => {
    it("deletes a target directory subtree", async () => {
      const calls: Array<Record<string, unknown>> = [];
      const handle = createHandleContentDirectoriesDelete({
        findContentDirectoryByIdAndWorkspace: async (id, workspaceId) => ({
          id,
          workspaceId,
          parentId: null,
          name: "Docs",
          pathSegment: "docs",
          createdBy: "user-1",
        }),
        deleteContentDirectorySubtreeByIdAndWorkspace: async (input) => {
          calls.push(input as unknown as Record<string, unknown>);
          return 3;
        },
      });

      const result = await handle(
        { directoryId: "dir-1" },
        { workspaceId: "ws-1", userId: "user-1" },
      );

      expect(calls).toEqual([
        {
          workspaceId: "ws-1",
          directoryId: "dir-1",
        },
      ]);
      expect(result).toEqual({ deletedCount: 3 });
    });

    it("rejects delete when directory does not exist in workspace", async () => {
      const handle = createHandleContentDirectoriesDelete({
        findContentDirectoryByIdAndWorkspace: async () => null,
        deleteContentDirectorySubtreeByIdAndWorkspace: async () => {
          throw new Error("should not be called");
        },
      });

      await expect(
        handle(
          { directoryId: "dir-1" },
          { workspaceId: "ws-1", userId: "user-1" },
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });
});
