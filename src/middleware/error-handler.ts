import type { Context } from "hono";
import { DomainError } from "../actions/errors";
import { logger } from "../infra/logger";

/**
 * Response envelope types for consistent error responses.
 */
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
  meta?: { requestId: string };
}

/**
 * Generates a unique request ID for error correlation.
 */
function generateRequestId(): string {
  return `req-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

/**
 * Creates a standard error response envelope.
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

export const errorHandler = (err: Error, c: Context) => {
  // Get or generate request ID for correlation
  const requestId = c.get("requestId") || generateRequestId();

  if (err instanceof DomainError) {
    logger.warn("DomainError:", {
      code: err.code,
      message: err.message,
      requestId,
    });

    return c.json(
      createErrorResponse(
        err.code,
        err.message,
        requestId,
        err.details ? (err.details as ApiErrorDetails) : undefined,
      ),
      err.statusCode as 400 | 403 | 404 | 500,
    );
  }

  logger.error("Unhandled Error:", {
    message: err.message,
    requestId,
    error: err,
  });
  return c.json(
    createErrorResponse("INTERNAL_ERROR", "Internal server error", requestId),
    500,
  );
};
