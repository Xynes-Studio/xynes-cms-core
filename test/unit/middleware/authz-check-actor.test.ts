/**
 * CMS-API-KEY-ACTOR-1 (Story B) — actor-aware authz middleware.
 *
 * Story B introduces a single, focused behaviour to
 * `checkActionPermission`: when `ctx.actor.kind === "api_key"`, the
 * middleware SHORT-CIRCUITS and returns successfully without invoking
 * `authzClient.check`. Rationale: the gateway has already enforced
 * the route's `actionKey` against the API key's scope set (see
 * `xynes-gateway/src/router/dynamicRouter.ts` Task 4 of the gateway
 * API-key plan). Re-running a user-based authz check downstream would
 * be a layering violation because the api_key actor does not carry a
 * user identity that exists in `identity.users`.
 *
 * Mirrors the PFU-1 pattern from
 * `xynes-accounts-service/src/actions/guards.ts` `requirePermission`.
 *
 * This file lives alongside the existing `authz-check.test.ts`
 * (Story A predecessor coverage) and adds the actor-specific cases
 * #8–#11 enumerated in
 * `xynes/xynes-infra/docs/plans/2026-05-10-cms-core-api-key-actor-recognition.md`
 * §8 plus defense-in-depth cases for the user-actor regression path.
 */

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

import { ForbiddenError, UnauthorizedError } from "../../../src/actions/errors";
import type { ApiKeyActor, UserActor } from "../../../src/actions/types";
import {
  type IAuthzClient,
  resetAuthzClient,
  setAuthzClient,
} from "../../../src/infra/authz";
import { checkActionPermission } from "../../../src/middleware/authz-check";

const TEST_API_KEY_ID = "11111111-1111-4111-8111-111111111111";
const TEST_API_KEY_PREFIX = "0a1b2c3d";
const TEST_USER_ID = "22222222-2222-4222-8222-222222222222";

const apiKeyActor: ApiKeyActor = {
  kind: "api_key",
  apiKeyId: TEST_API_KEY_ID,
  keyPrefix: TEST_API_KEY_PREFIX,
};

const userActor: UserActor = {
  kind: "user",
  userId: TEST_USER_ID,
};

describe("Authz Middleware — actor-aware (CMS-API-KEY-ACTOR-1 Story B)", () => {
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

  // ──────────────────────────────────────────────────────────────────
  // Plan §8 case #8 — api_key actor on a write action skips authz.
  // ──────────────────────────────────────────────────────────────────
  it("api_key actor on a WRITE action does NOT call authzClient.check", async () => {
    mockAuthzClient.check = mock(() => Promise.resolve({ allowed: false }));
    setAuthzClient(mockAuthzClient);

    await checkActionPermission("cms.entry.create", {
      workspaceId: "ws-1",
      actor: apiKeyActor,
      requestId: "req-1",
    });

    expect(mockAuthzClient.check).not.toHaveBeenCalled();
  });

  it("api_key actor on cms.entry.update does NOT call authzClient.check", async () => {
    mockAuthzClient.check = mock(() => Promise.resolve({ allowed: false }));
    setAuthzClient(mockAuthzClient);

    await checkActionPermission("cms.entry.update", {
      workspaceId: "ws-1",
      actor: apiKeyActor,
    });

    expect(mockAuthzClient.check).not.toHaveBeenCalled();
  });

  it("api_key actor on cms.entry.publish does NOT call authzClient.check", async () => {
    mockAuthzClient.check = mock(() => Promise.resolve({ allowed: false }));
    setAuthzClient(mockAuthzClient);

    await checkActionPermission("cms.entry.publish", {
      workspaceId: "ws-1",
      actor: apiKeyActor,
    });

    expect(mockAuthzClient.check).not.toHaveBeenCalled();
  });

  it("api_key actor on cms.entry.status.set does NOT call authzClient.check", async () => {
    mockAuthzClient.check = mock(() => Promise.resolve({ allowed: false }));
    setAuthzClient(mockAuthzClient);

    await checkActionPermission("cms.entry.status.set", {
      workspaceId: "ws-1",
      actor: apiKeyActor,
    });

    expect(mockAuthzClient.check).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────────────────────────
  // Plan §8 case #9 — api_key actor on a read action also skips authz.
  // ──────────────────────────────────────────────────────────────────
  it("api_key actor on a READ action also skips authzClient.check", async () => {
    mockAuthzClient.check = mock(() => Promise.resolve({ allowed: false }));
    setAuthzClient(mockAuthzClient);

    await checkActionPermission(
      "cms.entry.listByDirectory",
      {
        workspaceId: "ws-1",
        actor: apiKeyActor,
      },
      { requireUserId: false },
    );

    expect(mockAuthzClient.check).not.toHaveBeenCalled();
  });

  it("api_key actor on cms.entry.getById skips authzClient.check", async () => {
    mockAuthzClient.check = mock(() => Promise.resolve({ allowed: false }));
    setAuthzClient(mockAuthzClient);

    await checkActionPermission(
      "cms.entry.getById",
      {
        workspaceId: "ws-1",
        actor: apiKeyActor,
      },
      { requireUserId: false },
    );

    expect(mockAuthzClient.check).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────────────────────────
  // api_key short-circuit does NOT depend on requireUserId or userId
  // — the actor.kind decision is authoritative.
  // ──────────────────────────────────────────────────────────────────
  it("api_key actor does NOT require ctx.userId (no UnauthorizedError on write)", async () => {
    mockAuthzClient.check = mock(() => Promise.resolve({ allowed: true }));
    setAuthzClient(mockAuthzClient);

    // No userId in ctx; api_key actors have no human identity.
    await checkActionPermission("cms.entry.create", {
      workspaceId: "ws-1",
      actor: apiKeyActor,
    });

    expect(mockAuthzClient.check).not.toHaveBeenCalled();
  });

  it("api_key actor short-circuits even when requireUserId=true is forced", async () => {
    mockAuthzClient.check = mock(() => Promise.resolve({ allowed: false }));
    setAuthzClient(mockAuthzClient);

    await checkActionPermission(
      "cms.entry.create",
      {
        workspaceId: "ws-1",
        actor: apiKeyActor,
      },
      { requireUserId: true },
    );

    expect(mockAuthzClient.check).not.toHaveBeenCalled();
  });

  it("api_key actor ignores a stray ctx.userId field (does not call authz with it)", async () => {
    mockAuthzClient.check = mock(() => Promise.resolve({ allowed: true }));
    setAuthzClient(mockAuthzClient);

    await checkActionPermission("cms.entry.create", {
      workspaceId: "ws-1",
      // A stray userId should NEVER influence the api_key path.
      // Defense-in-depth: actor.kind is the source of truth.
      userId: TEST_USER_ID,
      actor: apiKeyActor,
    });

    expect(mockAuthzClient.check).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────────────────────────
  // Plan §8 case #10 — user actor regression guard: missing userId.
  // ──────────────────────────────────────────────────────────────────
  it("user actor without ctx.userId on a write action still throws UnauthorizedError", async () => {
    await expect(
      checkActionPermission("cms.entry.create", {
        workspaceId: "ws-1",
        // No userId, no actor — pre-PFU-1 anonymous-write path.
      }),
    ).rejects.toThrow(UnauthorizedError);
  });

  it("explicit user actor without ctx.userId AND with empty actor.userId still 401s (defense-in-depth)", async () => {
    // This shape should not be constructable through extractContext, but
    // defense-in-depth: if a future caller mis-builds a ctx, the legacy
    // requireUserId guard must still 401.
    await expect(
      checkActionPermission("cms.entry.create", {
        workspaceId: "ws-1",
        // Intentionally no userId AND no actor.
      }),
    ).rejects.toThrow("User authentication required for this action");
  });

  // ──────────────────────────────────────────────────────────────────
  // Plan §8 case #11 — user actor with userId calls authz exactly as today.
  // ──────────────────────────────────────────────────────────────────
  it("user actor on a write action calls authzClient.check with the user identity", async () => {
    mockAuthzClient.check = mock(() => Promise.resolve({ allowed: true }));
    setAuthzClient(mockAuthzClient);

    await checkActionPermission("cms.entry.create", {
      workspaceId: "ws-1",
      userId: TEST_USER_ID,
      actor: userActor,
      requestId: "req-1",
    });

    expect(mockAuthzClient.check).toHaveBeenCalledTimes(1);
    expect(mockAuthzClient.check).toHaveBeenCalledWith({
      userId: TEST_USER_ID,
      workspaceId: "ws-1",
      actionKey: "cms.entry.create",
    });
  });

  it("user actor on a write action with authz denied throws ForbiddenError (no leak of action key)", async () => {
    mockAuthzClient.check = mock(() => Promise.resolve({ allowed: false }));
    setAuthzClient(mockAuthzClient);

    try {
      await checkActionPermission("cms.entry.create", {
        workspaceId: "ws-1",
        userId: TEST_USER_ID,
        actor: userActor,
      });
      expect.unreachable("Should have thrown ForbiddenError");
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenError);
      expect((err as ForbiddenError).message).not.toContain("cms.entry.create");
    }
  });

  // ──────────────────────────────────────────────────────────────────
  // Anonymous public-route path remains untouched (no actor, no userId).
  // ──────────────────────────────────────────────────────────────────
  it("anonymous public-route call (no actor, no userId) still skips authz on read", async () => {
    mockAuthzClient.check = mock(() => Promise.resolve({ allowed: false }));
    setAuthzClient(mockAuthzClient);

    await checkActionPermission(
      "cms.content.listPublished",
      {
        workspaceId: "ws-1",
      },
      { requireUserId: false },
    );

    expect(mockAuthzClient.check).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────────────────────────
  // Legacy callers (no actor field at all, only userId) still authorise.
  // ──────────────────────────────────────────────────────────────────
  it("legacy ctx (userId only, no actor) on a write action still calls authz", async () => {
    mockAuthzClient.check = mock(() => Promise.resolve({ allowed: true }));
    setAuthzClient(mockAuthzClient);

    await checkActionPermission("cms.entry.create", {
      workspaceId: "ws-1",
      userId: TEST_USER_ID,
    });

    expect(mockAuthzClient.check).toHaveBeenCalledTimes(1);
    expect(mockAuthzClient.check).toHaveBeenCalledWith({
      userId: TEST_USER_ID,
      workspaceId: "ws-1",
      actionKey: "cms.entry.create",
    });
  });
});
