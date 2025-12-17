import { describe, it, expect } from "bun:test";
import {
  ContentTypesListForWorkspacePayloadSchema,
  createHandleContentTypesListForWorkspace,
} from "../../src/actions/handlers/content-types-list-for-workspace.handler";

describe("cms.content_types.listForWorkspace", () => {
  describe("ContentTypesListForWorkspacePayloadSchema", () => {
    it("defaults includeTemplates=false", () => {
      const result = ContentTypesListForWorkspacePayloadSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.includeTemplates).toBe(false);
      }
    });

    it("accepts includeTemplates=true", () => {
      const result = ContentTypesListForWorkspacePayloadSchema.safeParse({
        includeTemplates: true,
      });
      expect(result.success).toBe(true);
    });

    it("rejects unknown fields (strict)", () => {
      const result = ContentTypesListForWorkspacePayloadSchema.safeParse({
        includeTemplates: false,
        workspaceId: "ws-override",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("handler (unit)", () => {
    it("lists content types scoped to ctx.workspaceId", async () => {
      const calls: Array<{ workspaceId: string }> = [];

      const handle = createHandleContentTypesListForWorkspace({
        listContentTypesForWorkspace: async (workspaceId: string) => {
          calls.push({ workspaceId });
          return [
            {
              id: "ct-1",
              name: "Blog Post",
              slug: "blog-post",
              routeSegment: "blog",
              templateKey: "blog_post",
            },
          ];
        },
        listContentTypesForWorkspaceWithTemplates: async () => {
          throw new Error("should not be called");
        },
      });

      const result = await handle({ includeTemplates: false }, { workspaceId: "ws-1" });
      expect(calls).toEqual([{ workspaceId: "ws-1" }]);
      expect(result).toEqual([
        {
          id: "ct-1",
          name: "Blog Post",
          slug: "blog-post",
          routeSegment: "blog",
          templateKey: "blog_post",
        },
      ]);
    });

    it("includes template metadata when includeTemplates=true", async () => {
      const calls: Array<{ workspaceId: string }> = [];

      const handle = createHandleContentTypesListForWorkspace({
        listContentTypesForWorkspace: async () => {
          throw new Error("should not be called");
        },
        listContentTypesForWorkspaceWithTemplates: async (workspaceId: string) => {
          calls.push({ workspaceId });
          return [
            {
              id: "ct-1",
              name: "Blog Post",
              slug: "blog-post",
              routeSegment: "blog",
              templateKey: "blog_post",
              templateId: "t-1",
              template: {
                id: "t-1",
                key: "blog_post",
                name: "Blog Post",
                fieldsSchema: { title: { type: "string" } },
              },
            },
          ];
        },
      });

      const result = await handle({ includeTemplates: true }, { workspaceId: "ws-2" });
      expect(calls).toEqual([{ workspaceId: "ws-2" }]);
      expect(result).toEqual([
        {
          id: "ct-1",
          name: "Blog Post",
          slug: "blog-post",
          routeSegment: "blog",
          templateKey: "blog_post",
          templateId: "t-1",
          template: {
            id: "t-1",
            key: "blog_post",
            name: "Blog Post",
            fieldsSchema: { title: { type: "string" } },
          },
        },
      ]);
    });
  });
});
