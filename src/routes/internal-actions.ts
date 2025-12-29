import { type Context, Hono } from "hono";
import { ZodError, type ZodIssue, z } from "zod";
import {
  DomainError,
  MissingHeaderError,
  ValidationError,
} from "../actions/errors";
import { executeCmsAction } from "../actions/execute";
import type { CmsActionKey } from "../actions/types";
import { requireInternalServiceAuth } from "../middleware/internal-service-auth";

const internalActionsRoute = new Hono();
internalActionsRoute.use("*", requireInternalServiceAuth());

/**
 * Response envelope types for consistent responses.
 */
interface ApiMeta {
  requestId: string;
}

interface ApiSuccess<T> {
  ok: true;
  data: T;
  meta?: ApiMeta;
}

interface ApiErrorDetails {
  issues?: Array<{ path: (string | number)[]; message: string; code?: string }>;
  [key: string]: unknown;
}

interface ApiError {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: ApiErrorDetails;
  };
  meta?: ApiMeta;
}

/**
 * Generates a unique request ID for correlation.
 */
function generateRequestId(): string {
  return `req-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

/**
 * Creates a successful response envelope.
 */
function createSuccessResponse<T>(data: T, requestId?: string): ApiSuccess<T> {
  const response: ApiSuccess<T> = { ok: true, data };
  if (requestId) {
    response.meta = { requestId };
  }
  return response;
}

/**
 * Format Zod error to standard details format.
 */
function formatZodError(error: ZodError): ApiErrorDetails {
  return {
    issues: error.issues.map((issue: ZodIssue) => ({
      path: issue.path as (string | number)[],
      message: issue.message,
      code: issue.code,
    })),
  };
}

/**
 * Creates an error response envelope.
 */
function createErrorResponse(
  code: string,
  message: string,
  requestId?: string,
  details?: ApiErrorDetails,
): ApiError {
  const response: ApiError = {
    ok: false,
    error: { code, message },
  };
  if (details) {
    response.error.details = details;
  }
  if (requestId) {
    response.meta = { requestId };
  }
  return response;
}

// Helper to extract context
const extractContext = (c: Context, requestId: string) => {
  const workspaceId = c.req.header("X-Workspace-Id");
  const rawUserId = c.req.header("X-XS-User-Id");

  if (!workspaceId) {
    throw new MissingHeaderError("X-Workspace-Id");
  }

  const userId =
    rawUserId && rawUserId.trim().length > 0 ? rawUserId : undefined;

  return { workspaceId, userId, requestId };
};

internalActionsRoute.post("/", async (c) => {
  const requestId = generateRequestId();

  try {
    const ctx = extractContext(c, requestId);
    const body = await c.req.json();

    // Basic validation of body structure
    if (!body || typeof body !== "object" || !body.actionKey) {
      return c.json(
        createErrorResponse(
          "INVALID_REQUEST",
          "Invalid request body: missing actionKey",
          requestId,
        ),
        400,
      );
    }

    const { actionKey, payload } = body;

    const result = await executeCmsAction(
      actionKey as CmsActionKey,
      payload,
      ctx,
    );

    return c.json(createSuccessResponse(result, requestId));
  } catch (err: unknown) {
    // Zod validation errors - format with field-level details
    if (err instanceof ZodError) {
      return c.json(
        createErrorResponse(
          "VALIDATION_ERROR",
          "Payload validation failed",
          requestId,
          formatZodError(err),
        ),
        400,
      );
    }

    // DomainErrors - let them bubble to the global error handler
    if (err instanceof DomainError) {
      throw err;
    }

    // Unexpected errors - also bubble to global error handler
    throw err;
  }
});

export default internalActionsRoute;
