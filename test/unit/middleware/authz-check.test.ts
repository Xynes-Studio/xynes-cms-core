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

    it("should allow read actions without userId when requireUserId=false (skips authz)", async () => {
      mockAuthzClient.check = mock(() => Promise.resolve({ allowed: false }));
      setAuthzClient(mockAuthzClient);

      const ctx = {
        workspaceId: "ws-123",
        userId: undefined,
        requestId: "req-789",
      };

      // Should not throw for read actions - authz is skipped for anonymous
      await checkActionPermission("cms.content.listPublished", ctx, {
        requireUserId: false,
      });

      // CMS-COMMENTS-PUBLIC-1: Authz is NOT called for anonymous public actions
      expect(mockAuthzClient.check).not.toHaveBeenCalled();
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

    it("should skip authz for anonymous getPublishedBySlug action (CMS-COMMENTS-PUBLIC-1)", async () => {
      mockAuthzClient.check = mock(() => Promise.resolve({ allowed: false }));
      setAuthzClient(mockAuthzClient);

      const ctx = {
        workspaceId: "ws-123",
        userId: undefined,
        requestId: "req-789",
      };

      await checkActionPermission("cms.content.getPublishedBySlug", ctx, {
        requireUserId: false,
      });

      // CMS-COMMENTS-PUBLIC-1: Authz is NOT called for anonymous public actions
      expect(mockAuthzClient.check).not.toHaveBeenCalled();
    });

    it("should call authz for authenticated getPublishedBySlug action", async () => {
      mockAuthzClient.check = mock(() => Promise.resolve({ allowed: true }));
      setAuthzClient(mockAuthzClient);

      const ctx = {
        workspaceId: "ws-123",
        userId: "user-456",
        requestId: "req-789",
      };

      await checkActionPermission("cms.content.getPublishedBySlug", ctx, {
        requireUserId: false,
      });

      expect(mockAuthzClient.check).toHaveBeenCalledWith({
        userId: "user-456",
        workspaceId: "ws-123",
        actionKey: "cms.content.getPublishedBySlug",
      });
    });

    it("should return generic ForbiddenError message without leaking action key", async () => {
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
        // Security: Don't leak action key to client
        expect((err as ForbiddenError).message).not.toContain(
          "cms.content.create",
        );
        expect((err as ForbiddenError).message).toContain("permission");
      }
    });

    it("should skip authz check for anonymous users on public actions (CMS-COMMENTS-PUBLIC-1)", async () => {
      mockAuthzClient.check = mock(() => Promise.resolve({ allowed: false }));
      setAuthzClient(mockAuthzClient);

      const ctx = {
        workspaceId: "ws-123",
        userId: undefined, // Anonymous
        requestId: "req-789",
      };

      // Should NOT call authz and should NOT throw
      await checkActionPermission("cms.blog_entry.listPublished", ctx, {
        requireUserId: false,
      });

      // Verify authz was NOT called
      expect(mockAuthzClient.check).not.toHaveBeenCalled();
    });

    it("should skip authz check for anonymous comment creation (CMS-COMMENTS-PUBLIC-1)", async () => {
      mockAuthzClient.check = mock(() => Promise.resolve({ allowed: false }));
      setAuthzClient(mockAuthzClient);

      const ctx = {
        workspaceId: "ws-123",
        userId: undefined, // Anonymous
        requestId: "req-789",
      };

      // Should NOT call authz - handler enforces security instead
      await checkActionPermission("cms.comments.create", ctx, {
        requireUserId: false,
      });

      expect(mockAuthzClient.check).not.toHaveBeenCalled();
    });

    it("should still call authz for authenticated users on public actions", async () => {
      mockAuthzClient.check = mock(() => Promise.resolve({ allowed: true }));
      setAuthzClient(mockAuthzClient);

      const ctx = {
        workspaceId: "ws-123",
        userId: "user-456", // Authenticated
        requestId: "req-789",
      };

      await checkActionPermission("cms.blog_entry.listPublished", ctx, {
        requireUserId: false,
      });

      expect(mockAuthzClient.check).toHaveBeenCalledWith({
        userId: "user-456",
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
    const writeTestCases = [
      { action: "cms.content.create", isWrite: true },
      { action: "cms.content.update", isWrite: true },
      { action: "cms.content_entry.publish", isWrite: true },
      { action: "cms.comments.moderate", isWrite: true },
    ];

    const readTestCases = [
      { action: "cms.content.listPublished" },
      { action: "cms.content.getPublishedBySlug" },
      { action: "cms.blog_entry.read" },
      { action: "cms.templates.listGlobal" },
    ];

    for (const { action, isWrite } of writeTestCases) {
      it(`should require userId for ${action}`, async () => {
        mockAuthzClient.check = mock(() => Promise.resolve({ allowed: true }));
        setAuthzClient(mockAuthzClient);

        const ctx = {
          workspaceId: "ws-123",
          userId: "user-456",
        };

        // Write actions should succeed with userId and call authz
        await checkActionPermission(action, ctx);
        expect(mockAuthzClient.check).toHaveBeenCalled();
      });
    }

    for (const { action } of readTestCases) {
      it(`should skip authz for anonymous ${action} (CMS-COMMENTS-PUBLIC-1)`, async () => {
        mockAuthzClient.check = mock(() => Promise.resolve({ allowed: false }));
        setAuthzClient(mockAuthzClient);

        const ctx = {
          workspaceId: "ws-123",
          userId: undefined, // Anonymous
        };

        // Read actions skip authz for anonymous users
        await checkActionPermission(action, ctx, { requireUserId: false });
        expect(mockAuthzClient.check).not.toHaveBeenCalled();
      });

      it(`should call authz for authenticated ${action}`, async () => {
        mockAuthzClient.check = mock(() => Promise.resolve({ allowed: true }));
        setAuthzClient(mockAuthzClient);

        const ctx = {
          workspaceId: "ws-123",
          userId: "user-456", // Authenticated
        };

        // Read actions still call authz for authenticated users
        await checkActionPermission(action, ctx, { requireUserId: false });
        expect(mockAuthzClient.check).toHaveBeenCalled();
      });
    }
  });
});
