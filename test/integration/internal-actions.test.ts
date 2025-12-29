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

describe("POST /internal/cms-actions", () => {
  let mockAuthzClient: IAuthzClient;

  beforeEach(() => {
    // CMS-RBAC-1: Mock authz client to allow all actions in tests
    mockAuthzClient = {
      check: mock(() => Promise.resolve({ allowed: true })),
    };
    setAuthzClient(mockAuthzClient);
  });

  afterEach(() => {
    resetAuthzClient();
  });

  it("should execute a registered action and return result with envelope", async () => {
    // Register a test action
    const actionKey = "cms.test.http" as any;
    const schema = z.object({ msg: z.string() });
    const handler = async (payload: { msg: string }, ctx: any) => {
      return {
        echo: payload.msg,
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
      };
    };

    registerAction(actionKey, handler, schema);

    const res = await app.request("/internal/cms-actions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
        "X-Workspace-Id": "ws-integration",
        "X-XS-User-Id": "user-integration",
      },
      body: JSON.stringify({
        actionKey,
        payload: { msg: "hello world" },
      }),
    });

    expect(res.status).toBe(200);
    const body: any = await res.json();

    // New envelope format
    expect(body.ok).toBe(true);
    expect(body.meta?.requestId).toBeDefined();
    expect(body.data).toEqual({
      echo: "hello world",
      workspaceId: "ws-integration",
      userId: "user-integration",
    });
  });

  it("should return 400 for missing X-Workspace-Id with envelope", async () => {
    const res = await app.request("/internal/cms-actions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
        // Missing workspace id
      },
      body: JSON.stringify({
        actionKey: "cms.test.http",
        payload: { msg: "kthxbye" },
      }),
    });

    expect(res.status).toBe(400);
    const body: any = await res.json();

    // New envelope format
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("MISSING_HEADER");
    expect(body.error.message).toContain("X-Workspace-Id");
    expect(body.meta?.requestId).toBeDefined();
  });

  it("should return 400 with field-level details if validation fails", async () => {
    const actionKey = "cms.test.validation.http" as any;
    registerAction(actionKey, async () => ({}), z.object({ required: z.string() }));

    const res = await app.request("/internal/cms-actions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
        "X-Workspace-Id": "ws-1",
        "X-XS-User-Id": "user-1", // CMS-RBAC-1: Required for write actions
      },
      body: JSON.stringify({
        actionKey,
        payload: {}, // missing required
      }),
    });

    expect(res.status).toBe(400);
    const body: any = await res.json();

    // New envelope format with field-level details
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toBe("Payload validation failed");
    expect(body.error.details?.issues).toBeDefined();
    expect(body.error.details.issues.length).toBeGreaterThan(0);
    expect(body.meta?.requestId).toBeDefined();
  });

  it("should return 404 for unknown action with envelope", async () => {
    const res = await app.request("/internal/cms-actions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
        "X-Workspace-Id": "ws-1",
      },
      body: JSON.stringify({
        actionKey: "cms.unknown.http",
        payload: {},
      }),
    });

    // UnknownActionError is now a DomainError with statusCode 404
    expect(res.status).toBe(404);
    const body: any = await res.json();

    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("UNKNOWN_ACTION");
    expect(body.meta?.requestId).toBeDefined();
  });

  it("should return 400 for invalid body with envelope", async () => {
    const res = await app.request("/internal/cms-actions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
        "X-Workspace-Id": "ws-1",
      },
      body: JSON.stringify({
        // missing actionKey
        payload: {},
      }),
    });

    expect(res.status).toBe(400);
    const body: any = await res.json();

    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("INVALID_REQUEST");
    expect(body.meta?.requestId).toBeDefined();
  });

  it("should return 500 for unhandled errors with envelope", async () => {
    const actionKey = "cms.test.error" as any;
    // Register action that throws a generic Error
    registerAction(
      actionKey,
      async () => {
        throw new Error("Something bad happened");
      },
      z.object({})
    );

    const res = await app.request("/internal/cms-actions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
        "X-Workspace-Id": "ws-1",
        "X-XS-User-Id": "user-1", // CMS-RBAC-1: Required for write actions
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
    expect(body.meta?.requestId).toBeDefined();
  });

  it("should return 401 when X-Internal-Service-Token is missing", async () => {
    const actionKey = "cms.test.internalAuth.missing" as any;
    registerAction(actionKey, async () => ({ ok: true }), z.object({}));

    const res = await app.request("/internal/cms-actions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Id": "ws-1",
      },
      body: JSON.stringify({
        actionKey,
        payload: {},
      }),
    });

    expect(res.status).toBe(401);
    const body: any = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("should return 403 when X-Internal-Service-Token is mismatched", async () => {
    const actionKey = "cms.test.internalAuth.mismatch" as any;
    registerAction(actionKey, async () => ({ ok: true }), z.object({}));

    const res = await app.request("/internal/cms-actions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Service-Token": "wrong-token",
        "X-Workspace-Id": "ws-1",
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
