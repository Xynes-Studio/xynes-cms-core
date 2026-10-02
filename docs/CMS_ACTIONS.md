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
- `403 Forbidden`: Workspace authorization failed.
- `404 Not Found`: Unknown action key or entry not found.
- `500 Internal Server Error`: Unhandled exception.

---

## Available Actions

### `cms.content.create`

Legacy template-oriented create action. Dashboard authoring should use directory-first `cms.entry.create`.

**Payload**:
```json
{
  "contentTypeId": "uuid",
  "documentId": "uuid | null (optional)",
  "publishNow": "boolean (optional, can also be inside data)",
  "data": {
    "slug": "string (required)",
    "title": "string (required)"
    // ... template-specific fields
  }
}
```

**Response**:
```json
{
  "entry": {
    "id": "uuid",
    "contentTypeId": "uuid",
    "routeSegment": "string",
    "slug": "string",
    "status": "draft | published | archived",
    "publishedAt": "ISO string or null",
    "documentId": "uuid or null",
    "data": { "slug": "string", "title": "string" }
  }
}
```

**Errors**:
- `400`: Invalid payload (validation failed)
- `404`: legacy content configuration missing in workspace

### `cms.content.listPublished`

Lists validated last-publication entries by `routeSegment` for the current workspace. Tag filtering uses published tags; saved draft edits remain private. Missing/malformed snapshots or missing frozen legacy metadata are excluded until republish.

**Payload**:
```json
{
  "routeSegment": "string",
  "limit": "number (optional, default 10)",
  "offset": "number (optional, default 0)",
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
      "excerpt": "string | undefined",
      "tags": "string[] | undefined",
      "coverImageUrl": "string | undefined",
      "publishedAt": "ISO string",
      "documentId": "uuid | null"
    }
  ]
}
```

**Errors**:
- `400`: Invalid payload (validation failed)
- `404`: routeSegment not found for workspace

### `cms.content.getPublishedBySlug`

Reads the validated last publication by `routeSegment` + its published `slug` for the current workspace. Saving a new slug does not change this lookup until republish. Missing/invalid publications return 404 with no current-data fallback.

**Payload**:
```json
{
  "routeSegment": "string",
  "slug": "string"
}
```

**Response**:
```json
{
  "entry": {
    "id": "uuid",
    "slug": "string",
    "title": "string",
    "excerpt": "string | undefined",
    "tags": "string[] | undefined",
    "coverImageUrl": "string | undefined",
    "publishedAt": "ISO string",
    "documentId": "uuid | null",
    "data": { "slug": "string", "title": "string", "description": "string", "tags": [], "body": null }
  }
}
```

**Errors**:
- `400`: Invalid payload (validation failed)
- `404`: routeSegment not found for workspace, or slug not found

The generic detail `data` object includes only approved snapshot fields: slug, title, description, tags, body, and optional excerpt/coverImageUrl. Arbitrary custom/private draft data is no longer returned. The blog published actions reuse the same summary mapper and frozen slug/tag lookup. Authoring actions such as `cms.entry.getById` retain draft access under their existing permissions. Older publications without frozen legacy fields require explicit republish; this is an intentional compatibility change authorized for A3.

### `cms.content_directories.listForWorkspace`

Lists persisted content directories for the current workspace.

**Payload**:
```json
{}
```

**Response**:
```json
[
  {
    "id": "uuid",
    "parentId": "uuid | null",
    "name": "string",
    "pathSegment": "string"
  }
]
```

---

### `cms.entry.create`

Creates a directory-scoped entry for admin CMS authoring flows.

**Payload**:
```json
{
  "directoryId": "uuid | null (optional)",
  "title": "string (required)",
  "description": "string (optional)",
  "body": "object (optional)",
  "tags": ["string"],
  "ownerName": "string (optional)",
  "avatarUrl": "https://... (optional)",
  "publishNow": "boolean (optional)"
}
```

### `cms.entry.update`

Updates the current draft metadata/body by `entryId` in workspace scope. Saves retain the last publication until explicit republish, including its published folder.

### `cms.entry.delete`

Soft-deletes an entry (`deleted_at`, `deleted_by`) and keeps row data for auditing.

### `cms.entry.publish`

Captures the latest persisted draft under a workspace-scoped row lock and commits the versioned public snapshot, `status = published` and `published_at` atomically. Create-with-publish and scheduled activation share this validation. Invalid editor/summary data returns `PUBLICATION_INVALID` (400); a serialized snapshot above 1 MiB returns `PUBLICATION_TOO_LARGE` (400), leaving the prior publication intact.

Authoring entry DTOs add `deliveryState`: `available`, `unpublished` or `republish_required`. Published legacy entries without a valid snapshot require explicit republish. Snapshot/failure metadata is internal and omitted from DTOs. Archive, unpublish and soft delete hide retained snapshots immediately. A client receiving an older DTO without this field must treat availability as unknown. A3 now extends the snapshot guarantee to legacy generic/blog published endpoints. Missing validation fingerprints or frozen legacy metadata require explicit republish; current draft data never substitutes. See [publication policy and recovery](../DEVELOPER.md#publication-snapshots-cms-int-a2).

### `cms.entry.listByDirectory`

Lists directory-first entries with search/sort/status filters.

**Payload**:
```json
{
  "directoryId": "uuid | null (optional)",
  "search": "string (optional)",
  "sortBy": "date | title | popularity (optional)",
  "sortDirection": "asc | desc (optional)",
  "status": "draft | published | archived | all (optional)",
  "limit": "number (optional, default 20, max 100)",
  "offset": "number (optional, default 0)"
}
```

### `cms.entry.getById`

Reads one entry by ID, including collaborator names and actor favorite state.

### `cms.entry.collaborators.set`

Replaces collaborator set for an entry.

**Payload**:
```json
{
  "entryId": "uuid",
  "collaborators": [
    {
      "userId": "uuid",
      "displayName": "string (optional)"
    }
  ]
}
```

### `cms.entry.favorite.toggle`

Toggles favorite state for the current actor on one entry.

### `cms.entry.favorite.list`

Lists the current actor's favorited entries.

### `cms.entry.share.generateInternalLink`

Returns an authenticated internal edit URL:
`/dashboard/{workspaceSlug}/content/entry/{entryId}/edit`

**Errors**:
- `400`: Invalid payload (validation failed)

### `cms.content_directories.create`

Creates a persisted content directory in the current workspace.

**Payload**:
```json
{
  "name": "string (required, 1..80)",
  "parentId": "string | null (optional)"
}
```

**Behavior**:
- Normalizes `name` into a URL-safe `pathSegment`.
- Validates parent scope against persisted directory tree.
- Rejects `content-path-*` route-derived ephemeral parents.
- Prevents collisions with sibling directories and root-level reserved route segments.

**Response**:
```json
{
  "id": "uuid",
  "parentId": "string | null",
  "name": "string",
  "pathSegment": "string"
}
```

**Errors**:
- `400`: Invalid payload or business validation failure (invalid parent, duplicate name, route conflict)

### `cms.content_directories.update`

Renames an existing persisted content directory in the current workspace.

**Payload**:
```json
{
  "directoryId": "string (required)",
  "name": "string (required, 1..80)"
}
```

**Behavior**:
- Validates the target directory exists in the workspace.
- Normalizes `name` into `pathSegment`.
- Prevents sibling collisions.
- For root directories, prevents collisions with content-type route segments.

**Response**:
```json
{
  "id": "uuid",
  "parentId": "string | null",
  "name": "string",
  "pathSegment": "string"
}
```

**Errors**:
- `400`: Invalid payload or business validation failure (not found, duplicate name, route conflict)

### `cms.content_directories.delete`

Deletes a persisted content directory and all nested persisted subdirectories in the current workspace.

**Payload**:
```json
{
  "directoryId": "string (required)"
}
```

**Behavior**:
- Validates the target directory exists in the workspace.
- Deletes the full subtree using a workspace-scoped recursive query in one DB operation.

**Response**:
```json
{
  "deletedCount": "number"
}
```

**Errors**:
- `400`: Invalid payload or directory not found in workspace

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

### `cms.blog_entry.updateMeta`

Updates an existing **blog_post** entry’s metadata and/or publish state without touching document content.

**Payload**:
```json
{
  "id": "uuid (required)",
  "data": {
    "title": "string (optional)",
    "slug": "string (optional)",
    "excerpt": "string (optional)",
    "tags": ["string"] (optional),
    "coverImageUrl": "url (optional)"
  },
  "publishNow": "boolean (optional)",
  "unpublish": "boolean (optional)"
}
```

**Rules**:
- `id` is required
- At least one of `data`, `publishNow`, `unpublish` must be present
- `publishNow` and `unpublish` cannot both be `true`

**Behaviour**:
- Validates payload
- Ensures entry exists in `X-Workspace-Id` and is of `blog_post` content type
- If `data` provided, merges into existing JSON data (preserves other fields)
- If `publishNow=true`, sets `status="published"` and `publishedAt=now()`
- If `unpublish=true`, sets `status="draft"` and `publishedAt=null`
- Always updates `updatedAt`

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
- `404`: Entry not found

---

### `cms.blog_entry.read`

Deprecated compatibility action for legacy blog flows.

For directory-first CMS authoring and listing, use `cms.entry.*` actions instead.

**Payload**:
```json
{
  "contentTypeId": "uuid (required, legacy compatibility only)",
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
- `403`: legacy contentTypeId doesn't belong to workspace
- `404`: Entry not found (when slug provided)

---

### `cms.comments.create`

Creates a new comment on a content entry. Supports both authenticated and anonymous (public) comments.

**Route**: `POST /workspaces/:workspaceId/content-entries/:entryId/comments`
**Public Access**: ✅ Yes (CMS-COMMENTS-PUBLIC-1)

**Payload**:
```json
{
  "entryId": "uuid (required)",
  "parentId": "uuid or null (optional, for replies)",
  "displayName": "string (required for anonymous, max 100 chars)",
  "content": "string (required, 1..4000 chars for authenticated, 1..1000 chars for anonymous)"
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
- `400`: Display name is required for anonymous comments
- `400`: Comment content is too long for anonymous use (max 1000 chars)
- `404`: Entry not found (entryId doesn't exist in workspace)
- `404`: Comment not found (parentId doesn't exist)

**Security Measures (CMS-COMMENTS-PUBLIC-1)**:

| Feature | Authenticated | Anonymous |
|---------|--------------|-----------|
| Max content length | 4000 chars | 1000 chars |
| displayName required | No | Yes |
| Entry status required | Any (existing) | Published only |
| Default comment status | pending | pending |

- **Anonymous users can only comment on published entries** - Comments on drafts or scheduled posts are rejected with 404.
- **displayName is required for anonymous users** - Helps identify commenters and reduces spam.
- **All comments default to "pending"** - Requires moderation before public display.

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

Lists all comments for a content entry with optional status filtering. Supports both authenticated and anonymous (public) access.

**Route**: `GET /workspaces/:workspaceId/content-entries/:entryId/comments`
**Public Access**: ✅ Yes (CMS-COMMENTS-PUBLIC-1)

**Payload**:
```json
{
  "entryId": "uuid (required)",
  "includeReplies": "boolean (optional, default: true)",
  "statusFilter": "'approved' | 'pending' | 'all' (optional, default: 'approved')",
  "limit": "number (optional, default: 20, max: 100, clamped)",
  "offset": "number (optional, default: 0)"
}
```

**Pagination Safety**:
- `limit` is always clamped to a maximum of `100` before it reaches the DB layer.

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

**Security Measures (CMS-COMMENTS-PUBLIC-1)**:

| Feature | Authenticated | Anonymous |
|---------|--------------|-----------|
| statusFilter options | approved, pending, all | approved (forced) |
| Entry status required | Any (existing) | Published only |

- **Anonymous users can only list comments on published entries** - Listing comments on drafts returns 404.
- **statusFilter is forced to "approved" for anonymous users** - Prevents exposure of pending/moderated comments.

**Errors**:
- `400`: Invalid payload (validation failed)
- `404`: Entry not found (entryId doesn't exist in workspace, or not published for anonymous users)

**Validation Errors**:
See `cms.comments.create` for error format properties. `entryId` must be a valid UUID.

---

### `cms.blog_entry.listPublished`

Lists published blog entries, paginated and optionally filtered by tag. For 'blog-post' content type.

**Payload**:
```json
{
  "limit": "number (optional, default: 10, max: 100, clamped)",
  "offset": "number (optional, default: 0)",
  "tag": "string (optional)"
}
```

**Pagination Safety**:
- `limit` is always clamped to a maximum of `100` before it reaches the DB layer.

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

---

### `cms.templates.listGlobal`

Lists global templates from `cms.global_content_templates`.

**Payload**:
```json
{}
```

**Response**:
```json
[
  {
    "id": "uuid",
    "key": "string",
    "name": "string",
    "fieldsSchema": {}
  }
]
```

---

### `cms.content_types.listForWorkspace`

Lists content types for the current workspace (`X-Workspace-Id`).

Notes:
- `routeSegment` is the URL segment intended for generic content routing; it is unique per workspace.

**Payload**:
```json
{
  "includeTemplates": "boolean (optional, default false)"
}
```

**Response**:
```json
[
  {
    "id": "uuid",
    "name": "string",
    "slug": "string",
    "routeSegment": "string",
    "templateKey": "string",
    "templateId": "uuid (optional, if includeTemplates)",
    "template": {
      "id": "uuid",
      "key": "string",
      "name": "string",
      "fieldsSchema": {}
    }
  }
]
```


### `cms.delivery.listByDirectory` / `cms.delivery.getById` (CMS-INT-A3)

Private workspace-scoped delivery actions use the existing internal token and trusted actor context. A4 owns gateway route registration and permission/key scope grants; these actions add no custom credential mechanism.

| Input | Folder list | Entry detail |
| --- | --- | --- |
| Identity | Required `directoryId` UUID | Required `entryId` UUID |
| `fields` | CSV ≤128 chars: id/title/description/tags/publishedAt | Same fields plus body |
| `sortBy` | publishedAt (default), title | Unsupported |
| `sortDirection` | desc (default), asc | Unsupported |
| `limit` / `offset` | 20 / 0 defaults; 1–100 / 0–10000 | Unsupported |
| `search` | Optional trimmed nonempty text ≤200 chars | Unsupported |

All fields are returned by default; id cannot be removed. Empty/duplicate/unknown CSV selections and unknown payload keys fail with 400 `VALIDATION_ERROR`. Status/preview/HTML are not supported. Numeric-looking search text remains text through the gateway. Workspace comes from trusted context, never a payload override.

Folder response: `{ok:true,data:{items:[{id,title,description,tags,publishedAt}],page:{limit,offset,hasMore}},meta:...}`. Detail response: `{ok:true,data:{entry:{id,title,description,tags,publishedAt,body}},meta:...}`. Selected fields reduce each DTO; body is detail-only. One gateway envelope is retained by the coordinated delivery-specific gateway patch. The frozen A1 contract/response fixtures are pinned under `test/fixtures/cms-delivery`.

Feeds use the validated frozen folder/title/description, published time and stable UUID tie-breaks; they select only bounded summaries and use limit+1 rather than COUNT. Unsupported, historical, mutated, hidden, deleted, future and foreign publications share the safe unavailable outcome; entry detail returns 404 `ENTRY_NOT_FOUND` / `Published content unavailable`. Real empty folders succeed; transient database failures propagate. A save does not change delivery until valid republish. Apply additive migration 0009 before this CMS version, and explicitly republish historical entries. See [inputs, policy and deployment prerequisites](../DEVELOPER.md#bounded-folder-and-entry-delivery-cms-int-a3).
