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
- `404 Not Found`: Unknown action key.
- `500 Internal Server Error`: Unhandled exception.
