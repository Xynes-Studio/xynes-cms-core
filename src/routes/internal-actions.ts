import { type Context, Hono } from "hono";
import { ZodError, type ZodIssue, z } from "zod";
import {
  DomainError,
  MissingHeaderError,
  ValidationError,
} from "../actions/errors";
import { executeCmsAction } from "../actions/execute";
import type {
  ActionActor,
  ActionContext,
  CmsActionKey,
} from "../actions/types";
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

/**
 * CMS-API-KEY-ACTOR-1 (Story A) — Actor header schemas.
 *
 * The gateway emits these headers after a successful auth resolve:
 *   - `X-XS-Actor-Type`     : 'user' | 'api_key'   (defaults to 'user')
 *   - `X-XS-API-Key-Id`     : UUID                 (api_key only)
 *   - `X-XS-API-Key-Prefix` : 8 hex chars          (api_key only)
 *   - `X-XS-User-Id`        : UUID-ish identifier  (user only / public)
 *
 * `X-XS-API-Key-Prefix` is the first 8 hex chars of the secret portion
 * of `xynes_live_<hex>` — see
 * `xynes-gateway/src/security/apiKeyAuth.ts` (`API_KEY_LOOKUP_PREFIX_LENGTH`).
 * We validate the shape defensively so a malformed prefix never reaches
 * downstream audit / telemetry surfaces.
 */
const uuidHeaderSchema = z.string().uuid();
const apiKeyPrefixHeaderSchema = z
  .string()
  .regex(/^[a-f0-9]{8}$/, "must be 8 lowercase hex chars");

/**
 * Recognised actor-type values. The gateway will only emit these.
 * Anything else is an invalid header from a misbehaving caller and
 * we reject with 400 INVALID_HEADER before any handler runs.
 */
const ACTOR_KINDS = new Set(["user", "api_key"] as const);

/**
 * Thrown by `extractContext` when an actor header is structurally
 * malformed. Caught by the route handler and rendered as a 400
 * INVALID_HEADER envelope.
 */
class InvalidHeaderError extends Error {
  public readonly code = "INVALID_HEADER";
  public readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = "InvalidHeaderError";
  }
}

// Helper to extract context
const extractContext = (c: Context, requestId: string): ActionContext => {
  const workspaceId = c.req.header("X-Workspace-Id");

  if (!workspaceId) {
    throw new MissingHeaderError("X-Workspace-Id");
  }

  // CMS-API-KEY-ACTOR-1 (Story A): resolve the actor from gateway-emitted
  // internal headers. Defaults to 'user' when `X-XS-Actor-Type` is absent
  // to preserve pre-PFU-1 byte-for-byte behaviour for legacy callers.
  const rawActorType = c.req.header("X-XS-Actor-Type");
  if (rawActorType !== undefined && !ACTOR_KINDS.has(rawActorType as never)) {
    throw new InvalidHeaderError(
      "X-XS-Actor-Type must be one of: user, api_key",
    );
  }
  const actorType: "user" | "api_key" =
    rawActorType === "api_key" ? "api_key" : "user";

  let actor: ActionActor | undefined;
  let userId: string | undefined;

  if (actorType === "api_key") {
    const rawApiKeyId = c.req.header("X-XS-API-Key-Id");
    if (!rawApiKeyId) {
      throw new InvalidHeaderError(
        "X-XS-API-Key-Id header is required for api_key actor",
      );
    }
    const apiKeyIdResult = uuidHeaderSchema.safeParse(rawApiKeyId);
    if (!apiKeyIdResult.success) {
      throw new InvalidHeaderError("X-XS-API-Key-Id must be a UUID");
    }

    const rawApiKeyPrefix = c.req.header("X-XS-API-Key-Prefix");
    if (!rawApiKeyPrefix) {
      throw new InvalidHeaderError(
        "X-XS-API-Key-Prefix header is required for api_key actor",
      );
    }
    const apiKeyPrefixResult =
      apiKeyPrefixHeaderSchema.safeParse(rawApiKeyPrefix);
    if (!apiKeyPrefixResult.success) {
      throw new InvalidHeaderError(
        "X-XS-API-Key-Prefix must be 8 lowercase hex chars",
      );
    }

    actor = {
      kind: "api_key",
      apiKeyId: apiKeyIdResult.data,
      keyPrefix: apiKeyPrefixResult.data,
    };
    // userId stays undefined — api_key actors carry no user identity.
  } else {
    // user actor (default). Note: cms-core has always treated
    // `X-XS-User-Id` as optional to support public-route handlers
    // (e.g. anonymous `cms.comments.create`). We preserve that: if
    // the header is missing, `actor` is `undefined` and downstream
    // handlers may locally enforce `requireUserId` themselves.
    const rawUserId = c.req.header("X-XS-User-Id");
    const trimmed =
      rawUserId && rawUserId.trim().length > 0 ? rawUserId : undefined;
    if (trimmed !== undefined) {
      userId = trimmed;
      actor = { kind: "user", userId: trimmed };
    }
  }

  return { workspaceId, userId, actor, requestId };
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
    // CMS-API-KEY-ACTOR-1 (Story A): malformed actor / workspace headers
    // are surfaced as a 400 INVALID_HEADER envelope before any handler runs.
    if (err instanceof InvalidHeaderError) {
      return c.json(createErrorResponse(err.code, err.message, requestId), 400);
    }

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
