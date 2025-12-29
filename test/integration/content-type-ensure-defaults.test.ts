/**
 * Integration tests for cms.content_types.ensureDefaults action
 * CMS-TEMPLATE-CORE-1: Template-Driven Content Types
 *
 * Run with: RUN_INTEGRATION_TESTS=true bun test test/integration/content-type-ensure-defaults.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { app } from "../../src/index";
import { db } from "../../src/infra/db";
import {
  contentTypes,
  globalContentTemplates,
} from "../../src/infra/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { INTERNAL_SERVICE_TOKEN } from "../support/internal-auth";
import {
  DEFAULT_TEMPLATE_DEFINITIONS,
  DEFAULT_CONTENT_TYPE_DEFINITIONS,
} from "../../src/infra/db/seeders";

describe.skipIf(process.env.RUN_INTEGRATION_TESTS !== "true")(
  "Content Type Ensure Defaults Integration",
  () => {
    let testWorkspaceId: string;

    beforeAll(async () => {
      testWorkspaceId = crypto.randomUUID();
    });

    afterAll(async () => {
      // Clean up test data
      await db
        .delete(contentTypes)
        .where(eq(contentTypes.workspaceId, testWorkspaceId));
    });

    it("seeds all default templates and content types when no filter", async () => {
      const res = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
          "X-Workspace-Id": testWorkspaceId,
          "X-XS-User-Id": "test-user",
        },
        body: JSON.stringify({
          actionKey: "cms.content_types.ensureDefaults",
          payload: {},
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.ok).toBe(true);
      expect(body.data.processedTemplateKeys.length).toBe(
        DEFAULT_TEMPLATE_DEFINITIONS.length,
      );

      // Verify content types were created
      const createdTypes = await db
        .select()
        .from(contentTypes)
        .where(eq(contentTypes.workspaceId, testWorkspaceId));

      expect(createdTypes.length).toBe(
        DEFAULT_CONTENT_TYPE_DEFINITIONS.length,
      );

      // Verify each default content type exists
      for (const def of DEFAULT_CONTENT_TYPE_DEFINITIONS) {
        const ct = createdTypes.find((c) => c.slug === def.slug);
        expect(ct).toBeDefined();
        expect(ct?.templateKey).toBe(def.templateKey);
        expect(ct?.routeSegment).toBe(def.routeSegment);
      }
    });

    it("is idempotent - running twice does not duplicate", async () => {
      // First call
      await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
          "X-Workspace-Id": testWorkspaceId,
          "X-XS-User-Id": "test-user",
        },
        body: JSON.stringify({
          actionKey: "cms.content_types.ensureDefaults",
          payload: {},
        }),
      });

      // Second call
      const res = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
          "X-Workspace-Id": testWorkspaceId,
          "X-XS-User-Id": "test-user",
        },
        body: JSON.stringify({
          actionKey: "cms.content_types.ensureDefaults",
          payload: {},
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.ok).toBe(true);

      // All should be skipped on second run
      expect(body.data.contentTypes.skipped).toBe(
        DEFAULT_CONTENT_TYPE_DEFINITIONS.length,
      );
      expect(body.data.contentTypes.created).toBe(0);

      // Count should still be correct
      const count = await db
        .select()
        .from(contentTypes)
        .where(eq(contentTypes.workspaceId, testWorkspaceId));
      expect(count.length).toBe(DEFAULT_CONTENT_TYPE_DEFINITIONS.length);
    });

    it("seeds only filtered template types when templateKeys provided", async () => {
      const newWorkspaceId = crypto.randomUUID();

      const res = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
          "X-Workspace-Id": newWorkspaceId,
          "X-XS-User-Id": "test-user",
        },
        body: JSON.stringify({
          actionKey: "cms.content_types.ensureDefaults",
          payload: {
            templateKeys: ["program"],
          },
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.ok).toBe(true);
      expect(body.data.processedTemplateKeys).toEqual(["program"]);
      expect(body.data.contentTypes.created).toBe(1);

      // Verify only program was created
      const createdTypes = await db
        .select()
        .from(contentTypes)
        .where(eq(contentTypes.workspaceId, newWorkspaceId));

      expect(createdTypes.length).toBe(1);
      expect(createdTypes[0].templateKey).toBe("program");
      expect(createdTypes[0].routeSegment).toBe("programs");

      // Cleanup
      await db
        .delete(contentTypes)
        .where(eq(contentTypes.workspaceId, newWorkspaceId));
    });

    it("allows creating content with seeded program type", async () => {
      // First ensure defaults
      await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
          "X-Workspace-Id": testWorkspaceId,
          "X-XS-User-Id": "test-user",
        },
        body: JSON.stringify({
          actionKey: "cms.content_types.ensureDefaults",
          payload: {},
        }),
      });

      // Get the program content type
      const [programType] = await db
        .select()
        .from(contentTypes)
        .where(
          and(
            eq(contentTypes.workspaceId, testWorkspaceId),
            eq(contentTypes.templateKey, "program"),
          ),
        );

      expect(programType).toBeDefined();

      // Create a program entry
      const res = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
          "X-Workspace-Id": testWorkspaceId,
          "X-XS-User-Id": "test-user",
        },
        body: JSON.stringify({
          actionKey: "cms.content.create",
          payload: {
            contentTypeId: programType.id,
            publishNow: true,
            documentId: null,
            data: {
              slug: `test-program-${crypto.randomUUID()}`,
              title: "Introduction to TypeScript",
              duration: "4 weeks",
              level: "beginner",
            },
          },
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.ok).toBe(true);
      expect(body.data.entry.routeSegment).toBe("programs");
    });

    it("allows creating content with seeded event type", async () => {
      // Get the event content type
      const [eventType] = await db
        .select()
        .from(contentTypes)
        .where(
          and(
            eq(contentTypes.workspaceId, testWorkspaceId),
            eq(contentTypes.templateKey, "event"),
          ),
        );

      expect(eventType).toBeDefined();

      // Create an event entry
      const res = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
          "X-Workspace-Id": testWorkspaceId,
          "X-XS-User-Id": "test-user",
        },
        body: JSON.stringify({
          actionKey: "cms.content.create",
          payload: {
            contentTypeId: eventType.id,
            publishNow: true,
            documentId: null,
            data: {
              slug: `test-event-${crypto.randomUUID()}`,
              title: "TypeScript Conference 2025",
              startDate: "2025-06-15",
              location: "Online",
            },
          },
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.ok).toBe(true);
      expect(body.data.entry.routeSegment).toBe("events");
    });

    it("allows listing published content by routeSegment (generic, no hard-coded type)", async () => {
      // List programs via routeSegment
      const res = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
          "X-Workspace-Id": testWorkspaceId,
        },
        body: JSON.stringify({
          actionKey: "cms.content.listPublished",
          payload: {
            routeSegment: "programs",
            limit: 10,
          },
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.data.entries)).toBe(true);
    });

    it("is workspace-isolated - different workspaces have independent content types", async () => {
      const otherWorkspaceId = crypto.randomUUID();

      // Seed only blog for other workspace
      await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
          "X-Workspace-Id": otherWorkspaceId,
          "X-XS-User-Id": "test-user",
        },
        body: JSON.stringify({
          actionKey: "cms.content_types.ensureDefaults",
          payload: {
            templateKeys: ["blog_post"],
          },
        }),
      });

      // Verify other workspace only has blog
      const otherTypes = await db
        .select()
        .from(contentTypes)
        .where(eq(contentTypes.workspaceId, otherWorkspaceId));

      expect(otherTypes.length).toBe(1);
      expect(otherTypes[0].templateKey).toBe("blog_post");

      // Original workspace still has all types
      const originalTypes = await db
        .select()
        .from(contentTypes)
        .where(eq(contentTypes.workspaceId, testWorkspaceId));

      expect(originalTypes.length).toBe(DEFAULT_CONTENT_TYPE_DEFINITIONS.length);

      // Cleanup
      await db
        .delete(contentTypes)
        .where(eq(contentTypes.workspaceId, otherWorkspaceId));
    });
  },
);
