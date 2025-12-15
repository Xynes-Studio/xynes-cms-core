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

export class ContentTypeAccessDeniedError extends DomainError {
  constructor(contentTypeId: string, workspaceId: string) {
    super(
      `Content type ${contentTypeId} does not belong to workspace ${workspaceId}`,
      "CONTENT_TYPE_ACCESS_DENIED",
      403,
    );
  }
}

export class ContentTypeTemplateMismatchError extends DomainError {
  constructor(
    contentTypeId: string,
    expectedTemplateKey: string,
    actualTemplateKey: string,
  ) {
    super(
      `Content type ${contentTypeId} has template ${actualTemplateKey}, expected ${expectedTemplateKey}`,
      "CONTENT_TYPE_TEMPLATE_MISMATCH",
      400,
      {
        details: {
          contentTypeId,
          expectedTemplateKey,
          actualTemplateKey,
        },
      },
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
