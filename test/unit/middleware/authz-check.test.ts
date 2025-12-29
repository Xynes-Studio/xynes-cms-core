/**
 * Unit Tests for Authz Middleware
 *
 * CMS-RBAC-1: Tests for the authorization middleware that checks
 * permissions via authz service before allowing CMS action execution.
 */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import {
  checkActionPermission,
  type AuthzMiddlewareOptions,
} from "../../../src/middleware/authz-check";
import {
  setAuthzClient,
  resetAuthzClient,
  type IAuthzClient,
} from "../../../src/infra/authz";
import {
  ForbiddenError,
  UnauthorizedError,
} from "../../../src/actions/errors";

describe("Authz Middleware (Unit)", () => {
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

  describe("checkActionPermission()", () => {
    it("should allow action when authz returns allowed=true", async () => {
      mockAuthzClient.check = mock(() => Promise.resolve({ allowed: true }));
      setAuthzClient(mockAuthzClient);

      const ctx = {
        workspaceId: "ws-123",
        userId: "user-456",
        requestId: "req-789",
      };

      // Should not throw
      await checkActionPermission("cms.content.create", ctx);

      expect(mockAuthzClient.check).toHaveBeenCalledWith({
        userId: "user-456",
        workspaceId: "ws-123",
        actionKey: "cms.content.create",
      });
    });

    it("should throw ForbiddenError when authz returns allowed=false", async () => {
      mockAuthzClient.check = mock(() => Promise.resolve({ allowed: false }));
      setAuthzClient(mockAuthzClient);

      const ctx = {
        workspaceId: "ws-123",
        userId: "user-456",
        requestId: "req-789",
      };

      await expect(
        checkActionPermission("cms.content.create", ctx),
      ).rejects.toThrow(ForbiddenError);
    });

    it("should throw UnauthorizedError for create actions without userId", async () => {
      const ctx = {
        workspaceId: "ws-123",
        userId: undefined,
        requestId: "req-789",
      };

      await expect(
        checkActionPermission("cms.content.create", ctx),
      ).rejects.toThrow(UnauthorizedError);
    });

    it("should throw UnauthorizedError for update actions without userId", async () => {
      const ctx = {
        workspaceId: "ws-123",
        userId: undefined,
        requestId: "req-789",
      };

      await expect(
        checkActionPermission("cms.blog_entry.updateMeta", ctx),
      ).rejects.toThrow(UnauthorizedError);
    });

    it("should throw UnauthorizedError for publish actions without userId", async () => {
      const ctx = {
        workspaceId: "ws-123",
        userId: undefined,
        requestId: "req-789",
      };

      await expect(
        checkActionPermission("cms.content_entry.publish", ctx),
      ).rejects.toThrow(UnauthorizedError);
    });

    it("should throw UnauthorizedError for moderate actions without userId", async () => {
      const ctx = {
        workspaceId: "ws-123",
        userId: undefined,
        requestId: "req-789",
      };

      await expect(
        checkActionPermission("cms.comments.moderate", ctx),
      ).rejects.toThrow(UnauthorizedError);
    });

    it("should allow read actions without userId when requireUserId=false", async () => {
      mockAuthzClient.check = mock(() => Promise.resolve({ allowed: true }));
      setAuthzClient(mockAuthzClient);

      const ctx = {
        workspaceId: "ws-123",
        userId: undefined,
        requestId: "req-789",
      };

      // Should not throw for read actions
      await checkActionPermission("cms.content.listPublished", ctx, {
        requireUserId: false,
      });

      // Should have called authz with empty string for userId
      expect(mockAuthzClient.check).toHaveBeenCalledWith({
        userId: "",
        workspaceId: "ws-123",
        actionKey: "cms.content.listPublished",
      });
    });

    it("should check permission for listPublished action", async () => {
      mockAuthzClient.check = mock(() => Promise.resolve({ allowed: true }));
      setAuthzClient(mockAuthzClient);

      const ctx = {
        workspaceId: "ws-123",
        userId: "user-456",
        requestId: "req-789",
      };

      await checkActionPermission("cms.content.listPublished", ctx, {
        requireUserId: false,
      });

      expect(mockAuthzClient.check).toHaveBeenCalledWith({
        userId: "user-456",
        workspaceId: "ws-123",
        actionKey: "cms.content.listPublished",
      });
    });

    it("should check permission for getPublishedBySlug action", async () => {
      mockAuthzClient.check = mock(() => Promise.resolve({ allowed: true }));
      setAuthzClient(mockAuthzClient);

      const ctx = {
        workspaceId: "ws-123",
        userId: undefined,
        requestId: "req-789",
      };

      await checkActionPermission("cms.content.getPublishedBySlug", ctx, {
        requireUserId: false,
      });

      expect(mockAuthzClient.check).toHaveBeenCalledWith({
        userId: "",
        workspaceId: "ws-123",
        actionKey: "cms.content.getPublishedBySlug",
      });
    });

    it("should include actionKey in ForbiddenError message", async () => {
      mockAuthzClient.check = mock(() => Promise.resolve({ allowed: false }));
      setAuthzClient(mockAuthzClient);

      const ctx = {
        workspaceId: "ws-123",
        userId: "user-456",
        requestId: "req-789",
      };

      try {
        await checkActionPermission("cms.content.create", ctx);
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ForbiddenError);
        expect((err as ForbiddenError).message).toContain("cms.content.create");
      }
    });

    it("should work with empty userId for read when allowed by options", async () => {
      mockAuthzClient.check = mock(() => Promise.resolve({ allowed: true }));
      setAuthzClient(mockAuthzClient);

      const ctx = {
        workspaceId: "ws-123",
        userId: "",
        requestId: "req-789",
      };

      await checkActionPermission("cms.blog_entry.listPublished", ctx, {
        requireUserId: false,
      });

      expect(mockAuthzClient.check).toHaveBeenCalledWith({
        userId: "",
        workspaceId: "ws-123",
        actionKey: "cms.blog_entry.listPublished",
      });
    });

    it("should require userId for comments.create action", async () => {
      const ctx = {
        workspaceId: "ws-123",
        userId: undefined,
        requestId: "req-789",
      };

      await expect(
        checkActionPermission("cms.comments.create", ctx),
      ).rejects.toThrow(UnauthorizedError);
    });

    it("should use default requireUserId based on action type", async () => {
      mockAuthzClient.check = mock(() => Promise.resolve({ allowed: true }));
      setAuthzClient(mockAuthzClient);

      // Create actions should require userId by default
      const ctxWithUser = {
        workspaceId: "ws-123",
        userId: "user-456",
      };

      await checkActionPermission("cms.content.create", ctxWithUser);
      expect(mockAuthzClient.check).toHaveBeenCalled();
    });

    it("should propagate authz client errors", async () => {
      mockAuthzClient.check = mock(() =>
        Promise.reject(new Error("Authz service unavailable")),
      );
      setAuthzClient(mockAuthzClient);

      const ctx = {
        workspaceId: "ws-123",
        userId: "user-456",
        requestId: "req-789",
      };

      await expect(
        checkActionPermission("cms.content.create", ctx),
      ).rejects.toThrow("Authz service unavailable");
    });
  });

  describe("Write action detection", () => {
    const testCases = [
      { action: "cms.content.create", isWrite: true },
      { action: "cms.content.update", isWrite: true },
      { action: "cms.content_entry.publish", isWrite: true },
      { action: "cms.comments.moderate", isWrite: true },
      { action: "cms.content.listPublished", isWrite: false },
      { action: "cms.content.getPublishedBySlug", isWrite: false },
      { action: "cms.blog_entry.read", isWrite: false },
      { action: "cms.templates.listGlobal", isWrite: false },
    ];

    for (const { action, isWrite } of testCases) {
      it(`should ${isWrite ? "require" : "not require"} userId for ${action}`, async () => {
        mockAuthzClient.check = mock(() => Promise.resolve({ allowed: true }));
        setAuthzClient(mockAuthzClient);

        const ctx = {
          workspaceId: "ws-123",
          userId: isWrite ? "user-456" : undefined,
        };

        if (isWrite) {
          // Write actions should succeed with userId
          await checkActionPermission(action, ctx);
          expect(mockAuthzClient.check).toHaveBeenCalled();
        } else {
          // Read actions should succeed without userId when requireUserId=false
          await checkActionPermission(action, ctx, { requireUserId: false });
          expect(mockAuthzClient.check).toHaveBeenCalled();
        }
      });
    }
  });
});
