/**
 * Custom error types for CMS actions.
 * All errors extend DomainError for consistent error handling.
 */

export interface DomainErrorOptions {
  cause?: unknown;
  details?: unknown;
}

/**
 * Base class for all domain-level errors in CMS.
 */
export class DomainError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: unknown;
  public override readonly cause?: unknown;

  constructor(
    message: string,
    code = "DOMAIN_ERROR",
    statusCode = 400,
    options: DomainErrorOptions = {},
  ) {
    super(message);
    this.name = this.constructor.name; // Preserve class name for instanceof checks
    this.code = code;
    this.statusCode = statusCode;
    this.details = options.details;
    this.cause = options.cause;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ContentTypeNotFoundError extends DomainError {
  constructor(contentTypeId: string) {
    super(
      `Content type not found: ${contentTypeId}`,
      "CONTENT_TYPE_NOT_FOUND",
      404,
    );
  }
}

export class ContentTypeRouteSegmentNotFoundError extends DomainError {
  constructor(routeSegment: string) {
    super(
      `Content type not found for routeSegment: ${routeSegment}`,
      "CONTENT_TYPE_ROUTE_SEGMENT_NOT_FOUND",
      404,
    );
  }
}

export class ContentTypeAccessDeniedError extends DomainError {
  constructor(contentTypeId: string, workspaceId: string) {
    super(
      `Content type ${contentTypeId} does not belong to workspace ${workspaceId}`,
      "CONTENT_TYPE_ACCESS_DENIED",
      403,
    );
  }
}

export class EntryNotFoundError extends DomainError {
  constructor(slug: string) {
    super(`Entry not found: ${slug}`, "ENTRY_NOT_FOUND", 404);
  }
}

export class CommentNotFoundError extends DomainError {
  constructor(commentId: string) {
    super(`Comment not found: ${commentId}`, "COMMENT_NOT_FOUND", 404);
  }
}

export class UnknownActionError extends DomainError {
  constructor(actionKey: string) {
    super(`Unknown action: ${actionKey}`, "UNKNOWN_ACTION", 404);
  }
}

export class ValidationError extends DomainError {
  constructor(message = "Validation failed", details?: unknown) {
    super(message, "VALIDATION_ERROR", 400, { details });
  }
}

export class MissingHeaderError extends DomainError {
  constructor(headerName: string) {
    super(`Missing required header: ${headerName}`, "MISSING_HEADER", 400);
  }
}

/**
 * CMS-RBAC-1: Error thrown when user is not authenticated but authentication is required.
 */
export class UnauthorizedError extends DomainError {
  constructor(message = "User authentication required") {
    super(message, "UNAUTHORIZED", 401);
  }
}

/**
 * CMS-RBAC-1: Error thrown when user does not have permission for an action.
 */
export class ForbiddenError extends DomainError {
  constructor(message = "Permission denied") {
    super(message, "FORBIDDEN", 403);
  }
}

/**
 * CMS-API-KEY-ACTOR-1 (Story C): Error thrown when an action requires a
 * human (user) actor but was invoked by a non-user actor (e.g. an
 * `api_key` actor whose preset does not cover this action).
 *
 * Distinct error code from the generic {@link ForbiddenError} so that
 * downstream consumers can disambiguate "wrong actor kind" from
 * "permission denied for this user" without parsing messages. Mirrors
 * the `FORBIDDEN_ACTOR_KIND` code used by
 * `xynes-accounts-service/src/actions/guards.ts` `requireUserActor`
 * (PFU-1) so a single client-side handler can recognise both surfaces.
 */
export class ForbiddenActorKindError extends DomainError {
  constructor(message = "Action requires a user actor") {
    super(message, "FORBIDDEN_ACTOR_KIND", 403);
  }
}
