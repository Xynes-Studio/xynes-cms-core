# CMS Action Registry

The CMS Core Service not only provides direct REST API endpoints but also exposes an internal **Action Registry** invoked via a single HTTP endpoint. This pattern mirrors the `doc-service` architecture, facilitating internal communication (e.g., from the Gateway) using strongly-typed action keys.

## Architecture

The system consists of:
1.  **Registry**: A Map storing action handlers and their Zod schemas.
2.  **Executor**: A function `executeCmsAction` that handles lookup, validation, and execution.
3.  **Endpoint**: `POST /internal/cms-actions` which wraps the executor.

## How to Add a New Action

1.  **Define Action Key**:
    Add your new action key to `CmsActionKey` in `src/actions/types.ts`.
    ```typescript
    export type CmsActionKey =
      | 'cms.blog_entry.create'
      | 'cms.new_feature.do_something' // Add this
      // ...
    ```

2.  **Implement Handler**:
    Create a handler function that matches the `ActionHandler` signature.
    ```typescript
    import { ActionContext } from "./types";

    export const doSomethingHandler = async (payload: MyPayload, ctx: ActionContext) => {
        // Implementation
        return { result: "done" };
    };
    ```

3.  **Register Action**:
    Register the action (usually at startup or in a dedicated module) using `registerAction`.
    ```typescript
    import { registerAction } from "./registry";
    import { z } from "zod";

    registerAction(
        'cms.new_feature.do_something',
        doSomethingHandler,
        z.object({ someField: z.string() }) // Zod schema for payload
    );
    ```

## HTTP Endpoint

**URL**: `POST /internal/cms-actions`

**Headers**:
- `X-Workspace-Id` (Required): The workspace context.
- `X-XS-User-Id` (Optional): The user context.

**Body**:
```json
{
  "actionKey": "cms.new_feature.do_something",
  "payload": {
    "someField": "value"
  }
}
```

**Response**:
- `200 OK`: JSON result from the handler.
- `400 Bad Request`: Validation error or missing headers.
- `403 Forbidden`: Content type doesn't belong to workspace.
- `404 Not Found`: Unknown action key or entry not found.
- `500 Internal Server Error`: Unhandled exception.

---

## Available Actions

### `cms.blog_entry.create`

Creates a new blog entry for a content type.

**Payload**:
```json
{
  "contentTypeId": "uuid",
  "documentId": "uuid (optional)",
  "publishNow": "boolean (optional, can also be inside data)",
  "data": {
    "slug": "string (required)",
    "title": "string (required)",
    "excerpt": "string (optional)",
    "tags": ["string"] (optional),
    "coverImageUrl": "url (optional)",
    "publishedAt": "ISO string (optional)",
    "publishNow": "boolean (optional)"
  }
}
```

**Response**: 
```json
{
  "success": true,
  "entry": {
    "id": "uuid",
    "workspaceId": "uuid",
    "contentTypeId": "uuid",
    "documentId": "uuid or null",
    "data": { ... },
    "status": "draft | published",
    "publishedAt": "ISO string or null",
    "createdAt": "ISO string",
    "updatedAt": "ISO string"
  }
}
```

**Errors**:
- `400`: Invalid payload (validation failed)
- `403`: contentTypeId doesn't belong to workspace

---

### `cms.blog_entry.read`

Reads blog entries by content type, optionally filtered by slug.

**Payload**:
```json
{
  "contentTypeId": "uuid (required)",
  "slug": "string (optional)"
}
```

**Response (with slug)**: 
```json
{
  "entry": {
    "id": "uuid",
    "documentId": "uuid or null",
    "data": { ... }
    // ...other fields
  }
}
```
**Response (without slug)**: 
```json
{
  "entries": [
    {
      "id": "uuid",
      "documentId": "uuid or null",
      "data": { ... }
    }
  ]
}
```

**Errors**:
- `400`: Invalid payload
- `403`: contentTypeId doesn't belong to workspace
- `404`: Entry not found (when slug provided)

---

### `cms.comments.create`

Creates a new comment on a content entry.

**Payload**:
```json
{
  "entryId": "uuid (required)",
  "parentId": "uuid or null (optional, for replies)",
  "displayName": "string or null (optional, for guests)",
  "content": "string (required, min 1 char)"
}
```

**Response**: The created comment object:
```json
{
  "id": "uuid",
  "workspaceId": "uuid",
  "entryId": "uuid",
  "parentId": "uuid or null",
  "userId": "uuid or null",
  "displayName": "string or null",
  "content": "string",
  "status": "pending",
  "createdAt": "ISO timestamp",
  "updatedAt": "ISO timestamp"
}
```

**Errors**:
- `400`: Invalid payload (validation failed)
- `404`: Entry not found (entryId doesn't exist in workspace)
- `404`: Comment not found (parentId doesn't exist)

**Validation Errors**:
If the payload is invalid (e.g., `entryId` is not a UUID), the API returns a structured validation error:
```json
{
  "ok": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Payload validation failed",
    "details": {
      "issues": [
        {
          "path": ["entryId"],
          "message": "Invalid UUID",
          "code": "invalid_string"
        }
      ]
    }
  }
}
```

> [!WARNING]
> **Smoke Testing Note**: Do not use placeholder strings like `$TEST_ENTRY_ID` for `entryId` or other UUID fields. The validator enforces strict UUID format, and such requests will inevitably fail with a Validation Error. Always use a real UUID from a previously created resource.

---

### `cms.comments.listForEntry`

Lists all comments for a content entry with optional status filtering.

**Payload**:
  "entryId": "uuid (required)",
  "includeReplies": "boolean (optional, default: true)",
  "statusFilter": "'approved' | 'pending' | 'all' (optional, default: 'approved')",
  "limit": "number (optional, default: 20)",
  "offset": "number (optional, default: 0)"
}
```

**Response**: Array of comment DTOs sorted by `createdAt` ascending:
```json
[
  {
    "id": "uuid",
    "parentId": "uuid or null",
    "displayName": "string or null",
    "userId": "uuid or null",
    "content": "string",
    "status": "string",
    "createdAt": "ISO timestamp"
  }
]
```

**Status Filter Behavior**:
- `approved` (default): Returns only approved comments (safe for public display)
- `pending`: Returns only pending comments (for moderation UI)
- `all`: Returns all comments regardless of status

**Errors**:
- `400`: Invalid payload (validation failed)
- `404`: Entry not found (entryId doesn't exist in workspace)

**Validation Errors**:
See `cms.comments.create` for error format properties. `entryId` must be a valid UUID.

---

### `cms.blog_entry.listPublished`

Lists published blog entries, paginated and optionally filtered by tag. For 'blog-post' content type.

**Payload**:
```json
{
  "limit": "number (optional, default: 10)",
  "offset": "number (optional, default: 0)",
  "tag": "string (optional)"
}
```

**Response**:
```json
{
  "entries": [
    {
      "id": "uuid",
      "slug": "string",
      "title": "string",
      "excerpt": "string",
      "tags": ["string"],
      "coverImageUrl": "url",
      "publishedAt": "ISO string",
      "documentId": "uuid or null"
    }
  ]
}
```

**Errors**:
- `404`: Content type 'blog-post' not found in workspace

---

### `cms.blog_entry.listAdmin`

Lists all blog entries for admin UIs (draft + published + archived) in the current workspace. For `blog_post` content type.

**Ordering**: `updatedAt` DESC

**Payload**:
```json
{
  "status": "\"draft\" | \"published\" | \"archived\" | \"all\" (optional, default: \"all\")",
  "limit": "number (optional, default: 20, max: 100)",
  "offset": "number (optional, default: 0)",
  "search": "string (optional, searches title/slug case-insensitively)"
}
```

**Response**:
```json
{
  "items": [
    {
      "id": "uuid",
      "slug": "string",
      "title": "string",
      "status": "draft | published | archived",
      "publishedAt": "ISO string or null",
      "updatedAt": "ISO string",
      "documentId": "uuid or null",
      "data": "json"
    }
  ]
}
```

**Errors**:
- `404`: Content type `blog_post` not found in workspace

---

### `cms.blog_entry.getPublishedBySlug`

Gets a single published blog entry by slug. For 'blog-post' content type.

**Payload**:
```json
{
  "slug": "string (required)"
}
```

**Response**:
```json
{
  "entry": {
    "id": "uuid",
    "slug": "string",
    "title": "string",
    "excerpt": "string",
    "tags": ["string"],
    "coverImageUrl": "url",
    "publishedAt": "ISO string",
    "documentId": "uuid or null"
  }
}
```

**Errors**:
- `404`: Content type 'blog-post' not found
- `404`: Entry not found (or not published)
