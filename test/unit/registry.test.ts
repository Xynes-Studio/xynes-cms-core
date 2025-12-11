import { describe, it, expect, beforeEach } from "bun:test";
import { z } from "zod";
// These imports will fail initially
import { registerAction, getActionHandler } from "../../src/actions/registry";
import { executeCmsAction } from "../../src/actions/execute";
import type { ActionContext } from "../../src/actions/types";

describe("CMS Action Registry", () => {
  const mockContext: ActionContext = {
    workspaceId: "ws-123",
    userId: "user-456",
  };

  it("should register and retrieve an action handler", () => {
    const handler = async () => ({ success: true });
    // @ts-ignore
    registerAction("cms.test.action" as any, handler, z.object({}));

    // @ts-ignore
    const stored = getActionHandler("cms.test.action" as any);
    expect(stored).toBeDefined();
    expect(stored?.handler).toBe(handler);
  });

  it("should return undefined for unknown action", () => {
    // @ts-ignore
    const stored = getActionHandler("cms.unknown" as any);
    expect(stored).toBeUndefined();
  });
});

describe("CMS Action Execution", () => {
  const mockContext: ActionContext = {
    workspaceId: "ws-123",
    userId: "user-456",
  };

  it("should execute a registered action successfully", async () => {
    const actionKey = "cms.test.exec" as any;
    const schema = z.object({ value: z.string() });
    const handler = async (payload: { value: string }, ctx: ActionContext) => {
      return { received: payload.value, ctx };
    };

    // @ts-ignore
    registerAction(actionKey, handler, schema);

    const result = await executeCmsAction(actionKey, { value: "hello" }, mockContext);
    expect(result).toEqual({ received: "hello", ctx: mockContext });
  });

  it("should throw error for unknown action", async () => {
    const actionKey = "cms.unknown.exec" as any;
    expect(executeCmsAction(actionKey, {}, mockContext)).rejects.toThrow("Unknown action");
  });

  it("should throw validation error for invalid payload", async () => {
    const actionKey = "cms.test.validation" as any;
    const schema = z.object({ requiredField: z.string() });
    const handler = async () => ({});

    // @ts-ignore
    registerAction(actionKey, handler, schema);

    expect(executeCmsAction(actionKey, {}, mockContext)).rejects.toThrow();
  });
});
