/**
 * Unit tests for cms.content_type.ensureDefaults action handler
 * CMS-TEMPLATE-CORE-1: Template-Driven Content Types
 */

import { describe, expect, it, mock, beforeEach } from "bun:test";
import {
  ContentTypeEnsureDefaultsPayloadSchema,
  createHandleContentTypeEnsureDefaults,
  type ContentTypeEnsureDefaultsDeps,
  type EnsureDefaultsResult,
} from "../../src/actions/handlers/content-type-ensure-defaults.handler";
import type { ActionContext } from "../../src/actions/types";
import {
  DEFAULT_TEMPLATE_DEFINITIONS,
  DEFAULT_CONTENT_TYPE_DEFINITIONS,
} from "../../src/infra/db/seeders";

describe("cms.content_type.ensureDefaults handler", () => {
  describe("payload schema", () => {
    it("should accept empty payload", () => {
      const result = ContentTypeEnsureDefaultsPayloadSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it("should accept templateKeys filter", () => {
      const result = ContentTypeEnsureDefaultsPayloadSchema.safeParse({
        templateKeys: ["blog_post", "program"],
      });
      expect(result.success).toBe(true);
    });

    it("should reject invalid templateKeys type", () => {
      const result = ContentTypeEnsureDefaultsPayloadSchema.safeParse({
        templateKeys: "not-an-array",
      });
      expect(result.success).toBe(false);
    });

    it("should reject empty string in templateKeys", () => {
      const result = ContentTypeEnsureDefaultsPayloadSchema.safeParse({
        templateKeys: ["blog_post", ""],
      });
      expect(result.success).toBe(false);
    });
  });

  describe("handler", () => {
    let mockDeps: ContentTypeEnsureDefaultsDeps;
    let ctx: ActionContext;

    beforeEach(() => {
      mockDeps = {
        seedTemplate: mock(() => Promise.resolve()),
        seedContentType: mock(() => Promise.resolve()),
        findExistingTemplates: mock(() => Promise.resolve([])),
        findExistingContentTypeSlugs: mock(() => Promise.resolve([])),
        findExistingContentTypeRouteSegments: mock(() => Promise.resolve([])),
      };
      ctx = {
        workspaceId: "ws-123",
        userId: "user-456",
      };
    });

    it("should seed all default templates when no filter provided", async () => {
      const handler = createHandleContentTypeEnsureDefaults(mockDeps);
      const result = await handler({}, ctx);

      expect(mockDeps.seedTemplate).toHaveBeenCalledTimes(
        DEFAULT_TEMPLATE_DEFINITIONS.length,
      );
      expect(mockDeps.seedContentType).toHaveBeenCalledTimes(
        DEFAULT_CONTENT_TYPE_DEFINITIONS.length,
      );
    });

    it("should seed only filtered templates when templateKeys provided", async () => {
      const handler = createHandleContentTypeEnsureDefaults(mockDeps);
      const result = await handler({ templateKeys: ["blog_post"] }, ctx);

      expect(mockDeps.seedTemplate).toHaveBeenCalledTimes(1);
      expect(mockDeps.seedContentType).toHaveBeenCalledTimes(1);
    });

    it("should return created/skipped counts", async () => {
      const handler = createHandleContentTypeEnsureDefaults(mockDeps);
      const result = await handler({}, ctx);

      expect(result.templates).toBeDefined();
      expect(result.contentTypes).toBeDefined();
      expect(typeof result.templates.created).toBe("number");
      expect(typeof result.templates.skipped).toBe("number");
      expect(typeof result.contentTypes.created).toBe("number");
      expect(typeof result.contentTypes.skipped).toBe("number");
    });

    it("should skip existing templates", async () => {
      mockDeps.findExistingTemplates = mock(() =>
        Promise.resolve(["blog_post"]),
      );

      const handler = createHandleContentTypeEnsureDefaults(mockDeps);
      const result = await handler({ templateKeys: ["blog_post"] }, ctx);

      expect(result.templates.skipped).toBe(1);
      expect(result.templates.created).toBe(0);
    });

    it("should skip existing content types by slug", async () => {
      mockDeps.findExistingContentTypeSlugs = mock(() =>
        Promise.resolve(["blog-post"]),
      );

      const handler = createHandleContentTypeEnsureDefaults(mockDeps);
      const result = await handler({ templateKeys: ["blog_post"] }, ctx);

      expect(result.contentTypes.skipped).toBe(1);
      expect(result.contentTypes.created).toBe(0);
    });

    it("should skip existing content types by routeSegment", async () => {
      mockDeps.findExistingContentTypeRouteSegments = mock(() =>
        Promise.resolve(["blog"]),
      );

      const handler = createHandleContentTypeEnsureDefaults(mockDeps);
      const result = await handler({ templateKeys: ["blog_post"] }, ctx);

      expect(result.contentTypes.skipped).toBe(1);
      expect(result.contentTypes.created).toBe(0);
    });

    it("should use workspaceId from context", async () => {
      const handler = createHandleContentTypeEnsureDefaults(mockDeps);
      await handler({ templateKeys: ["blog_post"] }, ctx);

      expect(mockDeps.seedContentType).toHaveBeenCalledWith(
        expect.anything(),
        "ws-123",
        expect.anything(),
      );
    });

    it("should ignore unknown templateKeys gracefully", async () => {
      const handler = createHandleContentTypeEnsureDefaults(mockDeps);
      const result = await handler(
        { templateKeys: ["unknown_template"] },
        ctx,
      );

      expect(mockDeps.seedTemplate).toHaveBeenCalledTimes(0);
      expect(mockDeps.seedContentType).toHaveBeenCalledTimes(0);
      expect(result.templates.created).toBe(0);
      expect(result.contentTypes.created).toBe(0);
    });

    it("should return list of processed template keys", async () => {
      const handler = createHandleContentTypeEnsureDefaults(mockDeps);
      const result = await handler({ templateKeys: ["blog_post"] }, ctx);

      expect(result.processedTemplateKeys).toContain("blog_post");
    });
  });
});
