/**
 * CMS-API-KEY-ACTOR-1 (Story C) — actor-guards helper unit tests.
 *
 * Direct coverage for `src/middleware/actor-guards.ts`. The handler-level
 * tests in `handler-actor-audit.test.ts` cover the guards through real
 * call sites; this file covers the guards in isolation so regressions
 * surface independently of any handler refactor.
 */

import { describe, expect, it } from "bun:test";

import {
  ForbiddenActorKindError,
  UnauthorizedError,
} from "../../../src/actions/errors";
import type {
  ActionContext,
  ApiKeyActor,
  UserActor,
} from "../../../src/actions/types";
import {
  getOptionalUserId,
  isApiKeyActor,
  requireUserActor,
  requireUserActorForUserScopedAction,
} from "../../../src/middleware/actor-guards";

const WORKSPACE_ID = "f4f16484-3d37-491a-9799-fb44349d46df";
const USER_ID = "5e4c9542-72bc-4781-9f0f-8a21465de7de";
const API_KEY_ID = "11111111-1111-4111-8111-111111111111";
const API_KEY_PREFIX = "0a1b2c3d";

const apiKeyActor: ApiKeyActor = {
  kind: "api_key",
  apiKeyId: API_KEY_ID,
  keyPrefix: API_KEY_PREFIX,
};

const userActor: UserActor = {
  kind: "user",
  userId: USER_ID,
};

describe("actor-guards.requireUserActor", () => {
  it("returns userId for a user actor", () => {
    const ctx: ActionContext = {
      workspaceId: WORKSPACE_ID,
      actor: userActor,
    };
    expect(requireUserActor(ctx)).toBe(USER_ID);
  });

  it("returns the legacy ctx.userId when no actor is present (backwards compat)", () => {
    const ctx: ActionContext = {
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
    };
    expect(requireUserActor(ctx)).toBe(USER_ID);
  });

  it("prefers actor.userId over the legacy ctx.userId when both are set", () => {
    const ctx: ActionContext = {
      workspaceId: WORKSPACE_ID,
      userId: "stale-legacy-id",
      actor: userActor,
    };
    // The actor surface is the source of truth — pre-Story-A callers
    // that only populate `ctx.userId` are still supported, but a
    // present `actor` always wins.
    expect(requireUserActor(ctx)).toBe(USER_ID);
  });

  it("throws ForbiddenActorKindError for an api_key actor", () => {
    const ctx: ActionContext = {
      workspaceId: WORKSPACE_ID,
      actor: apiKeyActor,
    };
    expect(() => requireUserActor(ctx)).toThrow(ForbiddenActorKindError);
  });

  it("api_key actor with a stray ctx.userId still throws (defense-in-depth)", () => {
    const ctx: ActionContext = {
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      actor: apiKeyActor,
    };
    // `actor.kind` is the authoritative discriminator, NOT `userId`.
    // Otherwise a hostile fixture could bypass the guard by setting
    // both fields. The gateway never emits this shape but we
    // defense-in-depth on the read side anyway.
    expect(() => requireUserActor(ctx)).toThrow(ForbiddenActorKindError);
  });

  it("ForbiddenActorKindError carries the FORBIDDEN_ACTOR_KIND code and status 403", () => {
    const ctx: ActionContext = {
      workspaceId: WORKSPACE_ID,
      actor: apiKeyActor,
    };
    let caught: unknown;
    try {
      requireUserActor(ctx);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ForbiddenActorKindError);
    expect((caught as ForbiddenActorKindError).code).toBe(
      "FORBIDDEN_ACTOR_KIND",
    );
    expect((caught as ForbiddenActorKindError).statusCode).toBe(403);
  });

  it("throws UnauthorizedError with the canonical message when no actor and no userId", () => {
    const ctx: ActionContext = { workspaceId: WORKSPACE_ID };
    let caught: unknown;
    try {
      requireUserActor(ctx);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UnauthorizedError);
    // Match the same message the authz middleware uses for missing
    // JWT on a write action, so missing-auth is reported consistently.
    expect((caught as UnauthorizedError).message).toBe(
      "User authentication required for this action",
    );
    expect((caught as UnauthorizedError).statusCode).toBe(401);
  });

  it("requireUserActorForUserScopedAction is an alias of requireUserActor", () => {
    // Same identity — re-exported with an explicit name so user-scoped
    // handlers (e.g. favorite.toggle) read clearly at the call site.
    expect(requireUserActorForUserScopedAction).toBe(requireUserActor);
  });
});

describe("actor-guards.isApiKeyActor", () => {
  it("returns true for an api_key actor", () => {
    const ctx: ActionContext = {
      workspaceId: WORKSPACE_ID,
      actor: apiKeyActor,
    };
    expect(isApiKeyActor(ctx)).toBe(true);
  });

  it("returns false for a user actor", () => {
    const ctx: ActionContext = {
      workspaceId: WORKSPACE_ID,
      actor: userActor,
    };
    expect(isApiKeyActor(ctx)).toBe(false);
  });

  it("returns false when no actor is present (legacy path or anonymous)", () => {
    expect(isApiKeyActor({ workspaceId: WORKSPACE_ID, userId: USER_ID })).toBe(
      false,
    );
    expect(isApiKeyActor({ workspaceId: WORKSPACE_ID })).toBe(false);
  });

  it("does NOT fall back to ctx.userId when deciding actor kind", () => {
    // An api_key actor with a stray userId must still be reported
    // as api_key — see requireUserActor's defense-in-depth case.
    const ctx: ActionContext = {
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      actor: apiKeyActor,
    };
    expect(isApiKeyActor(ctx)).toBe(true);
  });
});

describe("actor-guards.getOptionalUserId", () => {
  it("returns userId for a user actor", () => {
    const ctx: ActionContext = {
      workspaceId: WORKSPACE_ID,
      actor: userActor,
    };
    expect(getOptionalUserId(ctx)).toBe(USER_ID);
  });

  it("returns null for an api_key actor", () => {
    const ctx: ActionContext = {
      workspaceId: WORKSPACE_ID,
      actor: apiKeyActor,
    };
    expect(getOptionalUserId(ctx)).toBeNull();
  });

  it("returns null for an api_key actor even with a stray ctx.userId", () => {
    const ctx: ActionContext = {
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      actor: apiKeyActor,
    };
    expect(getOptionalUserId(ctx)).toBeNull();
  });

  it("falls back to the legacy ctx.userId when no actor is set (backwards compat)", () => {
    const ctx: ActionContext = {
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
    };
    expect(getOptionalUserId(ctx)).toBe(USER_ID);
  });

  it("returns null for an anonymous ctx (no actor, no userId)", () => {
    expect(getOptionalUserId({ workspaceId: WORKSPACE_ID })).toBeNull();
  });
});
