import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import "../../src/actions/index";
import { Hono } from "hono";
import { ForbiddenError } from "../../src/actions/errors";
import { executeCmsAction } from "../../src/actions/execute";
import { getActionHandler, registerAction } from "../../src/actions/registry";
import type { ActionContext, RegisteredAction } from "../../src/actions/types";
import { resetAuthzClient, setAuthzClient } from "../../src/infra/authz";
import internalActionsRoute from "../../src/routes/internal-actions";
import { signedInit } from "../support/internal-request";

const boundary = new Hono();
boundary.route("/internal/cms-actions", internalActionsRoute);
const id = "11111111-1111-4111-8111-111111111111";
const context: ActionContext = {
  workspaceId: id,
  actor: { kind: "api_key", apiKeyId: id, keyPrefix: "12345678" },
};
const cases: [string, unknown, string][] = [
  [
    "cms.entry.create",
    { title: "fixture", publishNow: true },
    "cms.entry.publish",
  ],
  [
    "cms.content.create",
    {
      contentTypeId: id,
      data: { slug: "fixture", title: "fixture", publishNow: true },
    },
    "cms.entry.publish",
  ],
  [
    "cms.content.create",
    {
      contentTypeId: id,
      publishNow: true,
      data: { slug: "fixture", title: "fixture" },
    },
    "cms.entry.publish",
  ],
  [
    "cms.content.create",
    {
      contentTypeId: id,
      data: {
        slug: "fixture",
        title: "fixture",
        publishedAt: "2030-01-01T00:00:00Z",
      },
    },
    "cms.entry.publish",
  ],
  [
    "cms.blog_entry.create",
    {
      contentTypeId: id,
      publishNow: true,
      data: { slug: "fixture", title: "fixture" },
    },
    "cms.entry.publish",
  ],
  [
    "cms.blog_entry.create",
    {
      contentTypeId: id,
      data: { slug: "fixture", title: "fixture", publishNow: true },
    },
    "cms.entry.publish",
  ],
  [
    "cms.blog_entry.create",
    {
      contentTypeId: id,
      data: {
        slug: "fixture",
        title: "fixture",
        publishedAt: "2030-01-01T00:00:00Z",
      },
    },
    "cms.entry.publish",
  ],
  ["cms.blog_entry.updateMeta", { id, publishNow: true }, "cms.entry.publish"],
  [
    "cms.blog_entry.updateMeta",
    { id, unpublish: true },
    "cms.entry.status.set",
  ],
  [
    "cms.entry.status.set",
    { entryId: id, status: "published" },
    "cms.entry.publish",
  ],
  [
    "cms.entry.status.set",
    { entryId: id, status: "scheduled", publishAt: "2030-01-01T00:00:00Z" },
    "cms.entry.publish",
  ],
];
const originals = new Map<string, RegisteredAction>();
const writes = mock(async () => ({ id }));
beforeEach(() => {
  writes.mockClear();
  for (const [action] of cases) {
    if (originals.has(action)) continue;
    const registered = getActionHandler(action);
    if (!registered) throw new Error("Missing action " + action);
    originals.set(action, registered);
    registerAction(action, writes, registered.schema);
  }
  setAuthzClient({ check: async () => ({ allowed: true }) });
});
afterEach(() => {
  for (const [action, registered] of originals)
    registerAction(action, registered.handler, registered.schema);
  originals.clear();
  resetAuthzClient();
});
describe("CMS compound effect enforcement before handler invocation", () => {
  for (const [action, payload, effect] of cases) {
    it(`${action} fails closed for an older gateway's base-only approval`, async () => {
      await expect(
        executeCmsAction(action, payload, {
          ...context,
          gatewayAuthorizedActions: [action],
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect(writes).not.toHaveBeenCalled();
    });
    it(`${action} requires fresh human authorization for the effect`, async () => {
      setAuthzClient({
        check: async ({ actionKey }) => ({ allowed: actionKey !== effect }),
      });
      await expect(
        executeCmsAction(action, payload, {
          workspaceId: id,
          userId: id,
          actor: { kind: "user", userId: id },
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect(writes).not.toHaveBeenCalled();
    });
    it(`${action} accepts exactly the gateway's signed effect approvals`, async () => {
      const body = JSON.stringify({
        actionKey: action,
        payload,
        authorizedActions: [action, effect],
      });
      const response = await boundary.request(
        "/internal/cms-actions",
        signedInit("/internal/cms-actions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Workspace-Id": id,
            "X-XS-Actor-Type": "api_key",
            "X-XS-API-Key-Id": id,
            "X-XS-API-Key-Prefix": "12345678",
          },
          body,
        }),
      );
      expect(response.status).toBe(200);
      expect(writes).toHaveBeenCalledTimes(1);
    });
  }
  for (const authorizedActions of [
    null,
    "cms.entry.publish",
    [1],
    [""],
    ["a".repeat(121)],
    ["a", "b", "c", "d"],
  ]) {
    it("rejects malformed signed approvals before handler invocation", async () => {
      const body = JSON.stringify({
        actionKey: "cms.entry.create",
        payload: { title: "fixture", publishNow: true },
        authorizedActions,
      });
      const response = await boundary.request(
        "/internal/cms-actions",
        signedInit("/internal/cms-actions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Workspace-Id": id,
            "X-XS-Actor-Type": "api_key",
            "X-XS-API-Key-Id": id,
            "X-XS-API-Key-Prefix": "12345678",
          },
          body,
        }),
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        ok: false,
        error: { code: "VALIDATION_ERROR" },
      });
      expect(writes).not.toHaveBeenCalled();
    });
  }
  it("rejects an unsigned alteration of the effect approval", async () => {
    const original = JSON.stringify({
      actionKey: "cms.entry.create",
      payload: { title: "fixture", publishNow: true },
      authorizedActions: ["cms.entry.create"],
    });
    const init = signedInit("/internal/cms-actions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Id": id,
        "X-XS-Actor-Type": "api_key",
        "X-XS-API-Key-Id": id,
        "X-XS-API-Key-Prefix": "12345678",
      },
      body: original,
    });
    const response = await boundary.request("/internal/cms-actions", {
      ...init,
      body: original.replace(
        '["cms.entry.create"]',
        '["cms.entry.create","cms.entry.publish"]',
      ),
    });
    expect(response.status).toBe(403);
    expect(writes).not.toHaveBeenCalled();
  });
  it("does not accept approvals embedded in authoring payload data", async () => {
    await expect(
      executeCmsAction(
        "cms.content.create",
        {
          contentTypeId: id,
          data: {
            slug: "fixture",
            title: "fixture",
            publishNow: true,
            authorizedActions: ["cms.entry.create", "cms.entry.publish"],
          },
        },
        context,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(writes).not.toHaveBeenCalled();
  });
});
