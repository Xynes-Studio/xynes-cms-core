/**
 * Action Registration Module.
 * Registers all CMS action handlers on import.
 */
import { registerAction } from "./registry";
import {
  handleBlogEntryCreate,
  handleBlogEntryRead,
  BlogEntryCreatePayloadSchema,
  BlogEntryReadPayloadSchema,
} from "./handlers/blog-entry.handler";
import {
  handleCommentsCreate,
  CommentsCreatePayloadSchema,
} from "./handlers/comments-create.handler";

// Register blog entry actions
registerAction(
  "cms.blog_entry.create",
  handleBlogEntryCreate,
  BlogEntryCreatePayloadSchema
);

registerAction(
  "cms.blog_entry.read",
  handleBlogEntryRead,
  BlogEntryReadPayloadSchema
);

// Register comments actions
registerAction(
  "cms.comments.create",
  handleCommentsCreate,
  CommentsCreatePayloadSchema
);

export { handleBlogEntryCreate, handleBlogEntryRead, handleCommentsCreate };
