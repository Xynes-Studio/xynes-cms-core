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

export { handleBlogEntryCreate, handleBlogEntryRead };
