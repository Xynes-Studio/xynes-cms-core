/**
 * CMS-API-KEY-ACTOR-1 — Story A
 *
 * Unit tests for `extractContext` in `src/routes/internal-actions.ts`.
 *
 * Verifies that the internal CMS actions route recognises the actor
 * surface emitted by the gateway after the Workspace Admin API-key
 * enforcement work (gateway Tasks 4 + 5) and consumed downstream by
 * accounts-service (PFU-1 — see `AGENTS.md`).
 *
 * Contract under test (Story A only):
 *   - `X-XS-Actor-Type`     : 'user' | 'api_key'   (defaults to 'user')
 *   - `X-XS-API-Key-Id`     : UUID                 (api_key only)
 *   - `X-XS-API-Key-Prefix` : 8 lowercase hex chars (api_key only)
 *   - `X-XS-User-Id`        : optional identifier   (user only / public)
 *   - `X-Workspace-Id`      : required             (both)
 *
 * Story B (authz short-circuit on api_key) and Story C (per-handler
 * audit policy) are intentionally OUT OF SCOPE here. Tests that would
 * verify those behaviours register a capturing read action and mock
 * the authz client to `allowed: true`, isolating the contract to the
 * context-extraction layer.
 */

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { z } from "zod";
import { getActionHandler, registerAction } from "../src/actions/registry";
import type { ActionActor, ActionContext } from "../src/actions/types";
import { app } from "../src/index";
import {
  type IAuthzClient,
  resetAuthzClient,
  setAuthzClient,
} from "../src/infra/authz";
import { INTERNAL_SERVICE_TOKEN } from "./support/internal-auth";

/**
 * Action key used for the capturing handler.
 *
 * We deliberately reuse `cms.templates.listGlobal` because it appears in
 * the `PUBLIC_READ_ACTIONS` set inside `src/actions/execute.ts`, which
 * means `executeCmsAction` invokes the authz client with
 * `requireUserId: false`. That is the only execution mode where the
 * route reaches the handler regardless of whether the actor is `user`,
 * `api_key`, or anonymous — which is exactly the contract Story A is
 * verifying at the extraction layer. The original handler is captured
 * in `beforeEach` and restored in `afterEach` so global state is left
 * untouched for other test files.
 */
const CAPTURE_READ_KEY = "cms.templates.listGlobal" as const;

const VALID_API_KEY_ID = "11111111-1111-4111-8111-111111111111";
const VALID_API_KEY_PREFIX = "abcdef01";
const VALID_WORKSPACE_ID = "ws-vintage-violet";
const VALID_USER_ID = "user-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

interface CapturedCall {
  payload: unknown;
  ctx: ActionContext;
}

let captured: CapturedCall[] = [];
let originalAction: ReturnType<typeof getActionHandler>;

function installCapturingReadAction() {
  originalAction = getActionHandler(CAPTURE_READ_KEY);
  registerAction(
    CAPTURE_READ_KEY,
    async (payload, ctx) => {
      captured.push({ payload, ctx });
      return { captured: true };
    },
    z.object({}).passthrough(),
  );
}

function restoreCapturingReadAction() {
  if (originalAction) {
    registerAction(
      CAPTURE_READ_KEY,
      originalAction.handler,
      originalAction.schema as z.ZodSchema<unknown>,
    );
  }
}

/**
 * Returns the first captured call. Throws a clear message if the
 * capturing handler was never invoked — avoids non-null assertions
 * (`!`) and produces a more diagnosable failure than a generic
 * undefined-access error.
 */
function firstCaptured(): CapturedCall {
  const first = captured[0];
  if (!first) {
    throw new Error(
      "Capturing handler was not invoked — request likely rejected before reaching executeCmsAction",
    );
  }
  return first;
}

function requestActions(headers: Record<string, string>, body: unknown) {
  return app.request("/internal/cms-actions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe("CMS-API-KEY-ACTOR-1 (Story A) — Internal route actor header recognition", () => {
  let allowAllAuthz: IAuthzClient;

  beforeEach(() => {
    captured = [];
    allowAllAuthz = {
      check: mock(() => Promise.resolve({ allowed: true })),
    };
    setAuthzClient(allowAllAuthz);
    installCapturingReadAction();
  });

  afterEach(() => {
    resetAuthzClient();
    restoreCapturingReadAction();
  });

  describe("api_key actor — happy path", () => {
    it("populates ctx.actor with kind='api_key' and leaves ctx.userId undefined", async () => {
      const res = await requestActions(
        {
          "X-Workspace-Id": VALID_WORKSPACE_ID,
          "X-XS-Actor-Type": "api_key",
          "X-XS-API-Key-Id": VALID_API_KEY_ID,
          "X-XS-API-Key-Prefix": VALID_API_KEY_PREFIX,
        },
        { actionKey: CAPTURE_READ_KEY, payload: {} },
      );

      expect(res.status).toBe(200);
      expect(captured).toHaveLength(1);
      const ctx = firstCaptured().ctx;
      const actor = ctx.actor as ActionActor;

      expect(actor).toBeDefined();
      expect(actor.kind).toBe("api_key");
      if (actor.kind === "api_key") {
        expect(actor.apiKeyId).toBe(VALID_API_KEY_ID);
        expect(actor.keyPrefix).toBe(VALID_API_KEY_PREFIX);
      }
      expect(ctx.userId).toBeUndefined();
      expect(ctx.workspaceId).toBe(VALID_WORKSPACE_ID);
    });

    it("ignores X-XS-User-Id when actor type is api_key", async () => {
      // Defense-in-depth: a misbehaving gateway emitting BOTH actor types
      // should not produce a user identity on an api_key actor.
      const res = await requestActions(
        {
          "X-Workspace-Id": VALID_WORKSPACE_ID,
          "X-XS-Actor-Type": "api_key",
          "X-XS-API-Key-Id": VALID_API_KEY_ID,
          "X-XS-API-Key-Prefix": VALID_API_KEY_PREFIX,
          "X-XS-User-Id": VALID_USER_ID,
        },
        { actionKey: CAPTURE_READ_KEY, payload: {} },
      );

      expect(res.status).toBe(200);
      const ctx = firstCaptured().ctx;
      expect(ctx.userId).toBeUndefined();
      expect(ctx.actor?.kind).toBe("api_key");
    });
  });

  describe("api_key actor — 400 INVALID_HEADER", () => {
    it("rejects when X-XS-API-Key-Id is missing", async () => {
      const res = await requestActions(
        {
          "X-Workspace-Id": VALID_WORKSPACE_ID,
          "X-XS-Actor-Type": "api_key",
          "X-XS-API-Key-Prefix": VALID_API_KEY_PREFIX,
        },
        { actionKey: CAPTURE_READ_KEY, payload: {} },
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as {
        ok: boolean;
        error: { code: string; message: string };
      };
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe("INVALID_HEADER");
      expect(body.error.message).toContain("X-XS-API-Key-Id");
      expect(captured).toHaveLength(0);
    });

    it("rejects when X-XS-API-Key-Id is not a UUID", async () => {
      const res = await requestActions(
        {
          "X-Workspace-Id": VALID_WORKSPACE_ID,
          "X-XS-Actor-Type": "api_key",
          "X-XS-API-Key-Id": "not-a-uuid",
          "X-XS-API-Key-Prefix": VALID_API_KEY_PREFIX,
        },
        { actionKey: CAPTURE_READ_KEY, payload: {} },
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as {
        error: { code: string; message: string };
      };
      expect(body.error.code).toBe("INVALID_HEADER");
      expect(body.error.message).toContain("UUID");
      expect(captured).toHaveLength(0);
    });

    it("rejects when X-XS-API-Key-Prefix is missing", async () => {
      const res = await requestActions(
        {
          "X-Workspace-Id": VALID_WORKSPACE_ID,
          "X-XS-Actor-Type": "api_key",
          "X-XS-API-Key-Id": VALID_API_KEY_ID,
        },
        { actionKey: CAPTURE_READ_KEY, payload: {} },
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as {
        error: { code: string; message: string };
      };
      expect(body.error.code).toBe("INVALID_HEADER");
      expect(body.error.message).toContain("X-XS-API-Key-Prefix");
      expect(captured).toHaveLength(0);
    });

    it("rejects when X-XS-API-Key-Prefix is non-hex", async () => {
      const res = await requestActions(
        {
          "X-Workspace-Id": VALID_WORKSPACE_ID,
          "X-XS-Actor-Type": "api_key",
          "X-XS-API-Key-Id": VALID_API_KEY_ID,
          "X-XS-API-Key-Prefix": "ZZZZZZZZ",
        },
        { actionKey: CAPTURE_READ_KEY, payload: {} },
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as {
        error: { code: string; message: string };
      };
      expect(body.error.code).toBe("INVALID_HEADER");
      expect(body.error.message).toContain("hex");
      expect(captured).toHaveLength(0);
    });

    it("rejects when X-XS-API-Key-Prefix is wrong length", async () => {
      const res = await requestActions(
        {
          "X-Workspace-Id": VALID_WORKSPACE_ID,
          "X-XS-Actor-Type": "api_key",
          "X-XS-API-Key-Id": VALID_API_KEY_ID,
          "X-XS-API-Key-Prefix": "abcdef", // only 6 chars
        },
        { actionKey: CAPTURE_READ_KEY, payload: {} },
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as {
        error: { code: string; message: string };
      };
      expect(body.error.code).toBe("INVALID_HEADER");
      expect(captured).toHaveLength(0);
    });

    it("rejects when X-XS-API-Key-Prefix has uppercase hex chars", async () => {
      // Gateway emits the prefix as `xynes_live_<hex>` taken from the
      // first 8 chars of the SHA prefix — always lowercase. Uppercase
      // is a structural mismatch and must be rejected for log hygiene.
      const res = await requestActions(
        {
          "X-Workspace-Id": VALID_WORKSPACE_ID,
          "X-XS-Actor-Type": "api_key",
          "X-XS-API-Key-Id": VALID_API_KEY_ID,
          "X-XS-API-Key-Prefix": "ABCDEF01",
        },
        { actionKey: CAPTURE_READ_KEY, payload: {} },
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as {
        error: { code: string; message: string };
      };
      expect(body.error.code).toBe("INVALID_HEADER");
      expect(captured).toHaveLength(0);
    });
  });

  describe("X-XS-Actor-Type validation", () => {
    it("rejects unknown actor type values with 400 INVALID_HEADER", async () => {
      const res = await requestActions(
        {
          "X-Workspace-Id": VALID_WORKSPACE_ID,
          "X-XS-Actor-Type": "system",
          "X-XS-User-Id": VALID_USER_ID,
        },
        { actionKey: CAPTURE_READ_KEY, payload: {} },
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as {
        error: { code: string; message: string };
      };
      expect(body.error.code).toBe("INVALID_HEADER");
      expect(body.error.message).toContain("X-XS-Actor-Type");
      expect(captured).toHaveLength(0);
    });

    it("rejects empty string actor type", async () => {
      const res = await requestActions(
        {
          "X-Workspace-Id": VALID_WORKSPACE_ID,
          "X-XS-Actor-Type": "",
          "X-XS-User-Id": VALID_USER_ID,
        },
        { actionKey: CAPTURE_READ_KEY, payload: {} },
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as {
        error: { code: string };
      };
      expect(body.error.code).toBe("INVALID_HEADER");
      expect(captured).toHaveLength(0);
    });
  });

  describe("user actor — backwards compatibility", () => {
    it("treats a request without X-XS-Actor-Type as a user actor when X-XS-User-Id is present", async () => {
      const res = await requestActions(
        {
          "X-Workspace-Id": VALID_WORKSPACE_ID,
          "X-XS-User-Id": VALID_USER_ID,
        },
        { actionKey: CAPTURE_READ_KEY, payload: {} },
      );

      expect(res.status).toBe(200);
      const ctx = firstCaptured().ctx;
      expect(ctx.actor?.kind).toBe("user");
      if (ctx.actor?.kind === "user") {
        expect(ctx.actor.userId).toBe(VALID_USER_ID);
      }
      // Legacy `userId` field is also populated for handlers that have
      // not migrated to read `ctx.actor`.
      expect(ctx.userId).toBe(VALID_USER_ID);
    });

    it("treats X-XS-Actor-Type=user the same as no header (with X-XS-User-Id)", async () => {
      const res = await requestActions(
        {
          "X-Workspace-Id": VALID_WORKSPACE_ID,
          "X-XS-Actor-Type": "user",
          "X-XS-User-Id": VALID_USER_ID,
        },
        { actionKey: CAPTURE_READ_KEY, payload: {} },
      );

      expect(res.status).toBe(200);
      const ctx = firstCaptured().ctx;
      expect(ctx.actor?.kind).toBe("user");
      expect(ctx.userId).toBe(VALID_USER_ID);
    });

    it("returns ctx.actor=undefined for anonymous public-route calls (no X-XS-User-Id)", async () => {
      // cms-core has always treated `X-XS-User-Id` as optional to
      // support anonymous public handlers like `cms.comments.create`.
      // Story A must preserve this — no actor is resolved, but the
      // request still reaches the read handler.
      const res = await requestActions(
        {
          "X-Workspace-Id": VALID_WORKSPACE_ID,
        },
        { actionKey: CAPTURE_READ_KEY, payload: {} },
      );

      expect(res.status).toBe(200);
      const ctx = firstCaptured().ctx;
      expect(ctx.actor).toBeUndefined();
      expect(ctx.userId).toBeUndefined();
      expect(ctx.workspaceId).toBe(VALID_WORKSPACE_ID);
    });

    it("treats whitespace-only X-XS-User-Id as absent (legacy behaviour preserved)", async () => {
      const res = await requestActions(
        {
          "X-Workspace-Id": VALID_WORKSPACE_ID,
          "X-XS-User-Id": "   ",
        },
        { actionKey: CAPTURE_READ_KEY, payload: {} },
      );

      expect(res.status).toBe(200);
      const ctx = firstCaptured().ctx;
      expect(ctx.actor).toBeUndefined();
      expect(ctx.userId).toBeUndefined();
    });
  });

  describe("X-Workspace-Id (precondition for actor extraction)", () => {
    it("returns 400 MISSING_HEADER when X-Workspace-Id is absent (regression guard)", async () => {
      const res = await requestActions(
        {
          "X-XS-Actor-Type": "api_key",
          "X-XS-API-Key-Id": VALID_API_KEY_ID,
          "X-XS-API-Key-Prefix": VALID_API_KEY_PREFIX,
        },
        { actionKey: CAPTURE_READ_KEY, payload: {} },
      );

      // The workspace check fires before actor extraction. Pre-Story-A
      // callers relied on this and the envelope shape MUST NOT change.
      // MissingHeaderError is rendered by the global error handler.
      expect(res.status).toBe(400);
      const body = (await res.json()) as {
        error: { code: string; message: string };
      };
      expect(body.error.code).toBe("MISSING_HEADER");
      expect(body.error.message).toContain("X-Workspace-Id");
      expect(captured).toHaveLength(0);
    });
  });

  describe("ctx.requestId surface", () => {
    it("populates ctx.requestId so handlers can correlate logs", async () => {
      const res = await requestActions(
        {
          "X-Workspace-Id": VALID_WORKSPACE_ID,
          "X-XS-Actor-Type": "api_key",
          "X-XS-API-Key-Id": VALID_API_KEY_ID,
          "X-XS-API-Key-Prefix": VALID_API_KEY_PREFIX,
        },
        { actionKey: CAPTURE_READ_KEY, payload: {} },
      );

      expect(res.status).toBe(200);
      const ctx = firstCaptured().ctx;
      expect(typeof ctx.requestId).toBe("string");
      expect((ctx.requestId ?? "").length).toBeGreaterThan(0);
    });
  });
});
