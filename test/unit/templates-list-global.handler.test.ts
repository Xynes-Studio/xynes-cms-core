import { describe, it, expect } from "bun:test";
import {
  TemplatesListGlobalPayloadSchema,
  createHandleTemplatesListGlobal,
} from "../../src/actions/handlers/templates-list-global.handler";

describe("cms.templates.listGlobal", () => {
  describe("TemplatesListGlobalPayloadSchema", () => {
    it("accepts empty payload", () => {
      const result = TemplatesListGlobalPayloadSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it("rejects unknown fields (strict)", () => {
      const result = TemplatesListGlobalPayloadSchema.safeParse({ extra: 1 });
      expect(result.success).toBe(false);
    });
  });

  describe("handler (unit)", () => {
    it("returns global templates with name derived from description", async () => {
      const handle = createHandleTemplatesListGlobal({
        listGlobalContentTemplates: async () => [
          {
            id: "t-1",
            key: "blog_post",
            fieldsSchema: { title: { type: "string" } },
            description: "Blog Post",
          },
          {
            id: "t-2",
            key: "no_desc",
            fieldsSchema: { slug: { type: "string" } },
            description: null,
          },
        ],
      });

      const result = await handle({}, { workspaceId: "ws-1" });
      expect(result).toEqual([
        {
          id: "t-1",
          key: "blog_post",
          name: "Blog Post",
          fieldsSchema: { title: { type: "string" } },
        },
        {
          id: "t-2",
          key: "no_desc",
          name: "no_desc",
          fieldsSchema: { slug: { type: "string" } },
        },
      ]);
    });
  });
});

