import { Hono } from "hono";
import { executeCmsAction, UnknownActionError } from "../actions/execute";
import type { CmsActionKey } from "../actions/types";
import { 
  ContentTypeAccessDeniedError, 
  EntryNotFoundError 
} from "../actions/errors";
import { z } from "zod";

const internalActionsRoute = new Hono();

// Helper to extract context
const extractContext = (c: any) => {
  const workspaceId = c.req.header("X-Workspace-Id");
  const userId = c.req.header("X-XS-User-Id");

  if (!workspaceId) {
    throw new Error("Missing X-Workspace-Id header"); // Will be caught by error handler or local try/catch
  }

  return { workspaceId, userId };
};

internalActionsRoute.post("/", async (c) => {
  try {
    const { workspaceId, userId } = extractContext(c);
    const body = await c.req.json();
    
    // Basic validation of body structure
    if (!body || typeof body !== 'object' || !body.actionKey) {
       return c.json({ error: "Invalid request body: missing actionKey" }, 400); 
    }

    const { actionKey, payload } = body;

    const result = await executeCmsAction(actionKey as CmsActionKey, payload, { workspaceId, userId });

    return c.json(result);

  } catch (err: any) {
    if (err.message === "Missing X-Workspace-Id header") {
      return c.json({ error: "Missing X-Workspace-Id" }, 400);
    }
    
    if (err instanceof UnknownActionError) {
       return c.json({ error: err.message }, 404);
    }

    if (err instanceof ContentTypeAccessDeniedError) {
      return c.json({ error: err.message }, 403);
    }

    if (err instanceof EntryNotFoundError) {
      return c.json({ error: err.message }, 404);
    }

    if (err instanceof z.ZodError) {
      return c.json({ error: "Validation Error", details: err.errors }, 400);
    }

    // Pass to global error handler or generic 500
    throw err;
  }
});

export default internalActionsRoute;
