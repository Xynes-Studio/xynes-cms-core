/**
 * Custom error types for CMS actions.
 */

export class ContentTypeNotFoundError extends Error {
  constructor(contentTypeId: string) {
    super(`Content type not found: ${contentTypeId}`);
    this.name = "ContentTypeNotFoundError";
  }
}

export class ContentTypeAccessDeniedError extends Error {
  constructor(contentTypeId: string, workspaceId: string) {
    super(`Content type ${contentTypeId} does not belong to workspace ${workspaceId}`);
    this.name = "ContentTypeAccessDeniedError";
  }
}

export class EntryNotFoundError extends Error {
  constructor(slug: string) {
    super(`Entry not found: ${slug}`);
    this.name = "EntryNotFoundError";
  }
}

export class CommentNotFoundError extends Error {
  constructor(commentId: string) {
    super(`Comment not found: ${commentId}`);
    this.name = "CommentNotFoundError";
  }
}

