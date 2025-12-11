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
  "data": {
    "slug": "string (required)",
    "title": "string (required)",
    "excerpt": "string (optional)",
    "tags": ["string"] (optional),
    "coverImageUrl": "url (optional)",
    "publishedAt": "ISO string or null (optional)"
  }
}
```

**Response**: `{ success: true, entry: { ... } }`

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

**Response (with slug)**: `{ entry: { ... } }`  
**Response (without slug)**: `{ entries: [ ... ] }`

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
