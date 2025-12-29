/**
 * Integration Tests for Authz in CMS Actions
 *
 * CMS-RBAC-1: Tests for authorization enforcement in CMS actions.
 * These tests verify that:
 * 1. Write actions require userId
 * 2. Permission denied results in 403
 * 3. Workspace isolation is enforced
 */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { app } from "../../src/index";
import { registerAction } from "../../src/actions/registry";
import { z } from "zod";
import { INTERNAL_SERVICE_TOKEN } from "../support/internal-auth";
import {
  setAuthzClient,
  resetAuthzClient,
  type IAuthzClient,
} from "../../src/infra/authz";

describe("CMS-RBAC-1: Authz Integration", () => {
  let mockAuthzClient: IAuthzClient;

  beforeEach(() => {
    mockAuthzClient = {
      check: mock(() => Promise.resolve({ allowed: true })),
    };
    setAuthzClient(mockAuthzClient);
  });

  afterEach(() => {
    resetAuthzClient();
  });

  describe("Write Actions Authorization", () => {
    it("should allow create action when authz returns allowed=true", async () => {
      mockAuthzClient.check = mock(() => Promise.resolve({ allowed: true }));
      setAuthzClient(mockAuthzClient);

      const actionKey = "cms.test.authz.create" as any;
      registerAction(
        actionKey,
        async (payload: any, ctx: any) => ({
          created: true,
          workspaceId: ctx.workspaceId,
        }),
        z.object({ name: z.string() }),
      );

      const res = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
          "X-Workspace-Id": "ws-123",
          "X-XS-User-Id": "user-456",
        },
        body: JSON.stringify({
          actionKey,
          payload: { name: "Test Entry" },
        }),
      });

      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.ok).toBe(true);
      expect(body.data.created).toBe(true);

      // Verify authz was called with correct params
      expect(mockAuthzClient.check).toHaveBeenCalledWith({
        userId: "user-456",
        workspaceId: "ws-123",
        actionKey,
      });
    });

    it("should return 403 when authz returns allowed=false for create action", async () => {
      mockAuthzClient.check = mock(() => Promise.resolve({ allowed: false }));
      setAuthzClient(mockAuthzClient);

      const actionKey = "cms.test.authz.create.denied" as any;
      registerAction(
        actionKey,
        async () => ({ created: true }),
        z.object({ name: z.string() }),
      );

      const res = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
          "X-Workspace-Id": "ws-123",
          "X-XS-User-Id": "user-456",
        },
        body: JSON.stringify({
          actionKey,
          payload: { name: "Test Entry" },
        }),
      });

      expect(res.status).toBe(403);
      const body: any = await res.json();
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe("FORBIDDEN");
    });

    it("should return 401 for create action without userId", async () => {
      const actionKey = "cms.test.authz.create.nouser" as any;
      registerAction(
        actionKey,
        async () => ({ created: true }),
        z.object({ name: z.string() }),
      );

      const res = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
          "X-Workspace-Id": "ws-123",
          // No X-XS-User-Id
        },
        body: JSON.stringify({
          actionKey,
          payload: { name: "Test Entry" },
        }),
      });

      expect(res.status).toBe(401);
      const body: any = await res.json();
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe("UNAUTHORIZED");
    });

    it("should return 401 for update action without userId", async () => {
      const actionKey = "cms.test.authz.update.nouser" as any;
      registerAction(
        actionKey,
        async () => ({ updated: true }),
        z.object({ id: z.string() }),
      );

      const res = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
          "X-Workspace-Id": "ws-123",
        },
        body: JSON.stringify({
          actionKey,
          payload: { id: "entry-1" },
        }),
      });

      expect(res.status).toBe(401);
      const body: any = await res.json();
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe("UNAUTHORIZED");
    });

    it("should return 401 for publish action without userId", async () => {
      const actionKey = "cms.test.authz.publish.nouser" as any;
      registerAction(
        actionKey,
        async () => ({ published: true }),
        z.object({ entryId: z.string() }),
      );

      const res = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
          "X-Workspace-Id": "ws-123",
        },
        body: JSON.stringify({
          actionKey,
          payload: { entryId: "entry-1" },
        }),
      });

      expect(res.status).toBe(401);
      const body: any = await res.json();
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe("UNAUTHORIZED");
    });

    it("should return 401 for moderate action without userId", async () => {
      const actionKey = "cms.test.authz.moderate.nouser" as any;
      registerAction(
        actionKey,
        async () => ({ moderated: true }),
        z.object({ commentId: z.string() }),
      );

      const res = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
          "X-Workspace-Id": "ws-123",
        },
        body: JSON.stringify({
          actionKey,
          payload: { commentId: "comment-1" },
        }),
      });

      expect(res.status).toBe(401);
      const body: any = await res.json();
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe("UNAUTHORIZED");
    });
  });

  describe("Read Actions Authorization", () => {
    it("should allow listPublished action without userId when authz allows", async () => {
      mockAuthzClient.check = mock(() => Promise.resolve({ allowed: true }));
      setAuthzClient(mockAuthzClient);

      // Use the actual registered action
      const res = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
          "X-Workspace-Id": "ws-123",
          // No X-XS-User-Id - should be allowed for read actions
        },
        body: JSON.stringify({
          actionKey: "cms.content.listPublished",
          payload: { routeSegment: "blog" },
        }),
      });

      // Should not get 401, might get 404 if no content types exist
      expect(res.status).not.toBe(401);

      // Verify authz was called
      expect(mockAuthzClient.check).toHaveBeenCalledWith({
        userId: "",
        workspaceId: "ws-123",
        actionKey: "cms.content.listPublished",
      });
    });

    it("should return 403 for listPublished when authz denies", async () => {
      mockAuthzClient.check = mock(() => Promise.resolve({ allowed: false }));
      setAuthzClient(mockAuthzClient);

      const res = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
          "X-Workspace-Id": "ws-123",
        },
        body: JSON.stringify({
          actionKey: "cms.content.listPublished",
          payload: { routeSegment: "blog" },
        }),
      });

      expect(res.status).toBe(403);
      const body: any = await res.json();
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe("FORBIDDEN");
    });

    it("should allow getPublishedBySlug action without userId when authz allows", async () => {
      mockAuthzClient.check = mock(() => Promise.resolve({ allowed: true }));
      setAuthzClient(mockAuthzClient);

      const res = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
          "X-Workspace-Id": "ws-123",
        },
        body: JSON.stringify({
          actionKey: "cms.content.getPublishedBySlug",
          payload: { routeSegment: "blog", slug: "my-post" },
        }),
      });

      // Should not get 401
      expect(res.status).not.toBe(401);

      // Verify authz was called
      expect(mockAuthzClient.check).toHaveBeenCalledWith({
        userId: "",
        workspaceId: "ws-123",
        actionKey: "cms.content.getPublishedBySlug",
      });
    });
  });

  describe("Workspace Isolation", () => {
    it("should pass workspaceId to authz check", async () => {
      mockAuthzClient.check = mock(() => Promise.resolve({ allowed: true }));
      setAuthzClient(mockAuthzClient);

      const actionKey = "cms.test.workspace.isolation" as any;
      registerAction(
        actionKey,
        async (payload: any, ctx: any) => ({
          workspaceId: ctx.workspaceId,
        }),
        z.object({}),
      );

      const res = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
          "X-Workspace-Id": "workspace-abc-123",
          "X-XS-User-Id": "user-456",
        },
        body: JSON.stringify({
          actionKey,
          payload: {},
        }),
      });

      expect(res.status).toBe(200);

      // Verify authz was called with correct workspaceId
      expect(mockAuthzClient.check).toHaveBeenCalledWith({
        userId: "user-456",
        workspaceId: "workspace-abc-123",
        actionKey,
      });
    });

    it("should deny access when user tries to access different workspace", async () => {
      mockAuthzClient.check = mock(() => Promise.resolve({ allowed: false }));
      setAuthzClient(mockAuthzClient);

      const actionKey = "cms.test.workspace.cross" as any;
      registerAction(
        actionKey,
        async () => ({ data: "sensitive" }),
        z.object({}),
      );

      const res = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
          "X-Workspace-Id": "other-workspace",
          "X-XS-User-Id": "user-456",
        },
        body: JSON.stringify({
          actionKey,
          payload: {},
        }),
      });

      expect(res.status).toBe(403);
      const body: any = await res.json();
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe("FORBIDDEN");
    });
  });

  describe("Authz Service Errors", () => {
    it("should return 500 when authz service is unavailable", async () => {
      mockAuthzClient.check = mock(() =>
        Promise.reject(new Error("Authz service unavailable")),
      );
      setAuthzClient(mockAuthzClient);

      const actionKey = "cms.test.authz.error" as any;
      registerAction(
        actionKey,
        async () => ({ success: true }),
        z.object({}),
      );

      const res = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
          "X-Workspace-Id": "ws-123",
          "X-XS-User-Id": "user-456",
        },
        body: JSON.stringify({
          actionKey,
          payload: {},
        }),
      });

      expect(res.status).toBe(500);
      const body: any = await res.json();
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe("INTERNAL_ERROR");
    });
  });

  describe("CMS Action Keys", () => {
    const writeActions = [
      "cms.content.create",
      "cms.blog_entry.create",
      "cms.blog_entry.updateMeta",
      "cms.comments.create",
    ];

    const readActions = [
      "cms.content.listPublished",
      "cms.content.getPublishedBySlug",
      "cms.blog_entry.listPublished",
      "cms.blog_entry.getPublishedBySlug",
      "cms.comments.listForEntry",
      "cms.templates.listGlobal",
      "cms.content_types.listForWorkspace",
    ];

    for (const actionKey of writeActions) {
      it(`should call authz for write action: ${actionKey}`, async () => {
        mockAuthzClient.check = mock(() => Promise.resolve({ allowed: true }));
        setAuthzClient(mockAuthzClient);

        // Make request (may fail validation but authz should be checked first)
        await app.request("/internal/cms-actions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
            "X-Workspace-Id": "ws-123",
            "X-XS-User-Id": "user-456",
          },
          body: JSON.stringify({
            actionKey,
            payload: {},
          }),
        });

        // Verify authz was called
        expect(mockAuthzClient.check).toHaveBeenCalledWith(
          expect.objectContaining({
            actionKey,
            workspaceId: "ws-123",
            userId: "user-456",
          }),
        );
      });
    }

    for (const actionKey of readActions) {
      it(`should call authz for read action: ${actionKey}`, async () => {
        mockAuthzClient.check = mock(() => Promise.resolve({ allowed: true }));
        setAuthzClient(mockAuthzClient);

        // Make request without userId (should be allowed for read)
        await app.request("/internal/cms-actions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
            "X-Workspace-Id": "ws-123",
          },
          body: JSON.stringify({
            actionKey,
            payload: {},
          }),
        });

        // Verify authz was called
        expect(mockAuthzClient.check).toHaveBeenCalledWith(
          expect.objectContaining({
            actionKey,
            workspaceId: "ws-123",
          }),
        );
      });
    }
  });
});
