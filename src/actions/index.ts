/**
 * Action Registration Module.
 * Registers all CMS action handlers on import.
 */
import { registerAction } from "./registry";
import {
  handleBlogEntryCreate,
  handleBlogEntryRead,
  handleBlogEntryListPublished,
  handleBlogEntryGetPublishedBySlug,
  BlogEntryCreatePayloadSchema,
  BlogEntryReadPayloadSchema,
  BlogEntryListPublishedPayloadSchema,
  BlogEntryGetPublishedBySlugPayloadSchema,
} from "./handlers/blog-entry.handler";
import {
  handleCommentsCreate,
  CommentsCreatePayloadSchema,
} from "./handlers/comments-create.handler";
import {
  handleCommentsListForEntry,
  CommentsListForEntryPayloadSchema,
} from "./handlers/comments-list.handler";

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

registerAction(
  "cms.blog_entry.listPublished",
  handleBlogEntryListPublished,
  BlogEntryListPublishedPayloadSchema
);

registerAction(
  "cms.blog_entry.getPublishedBySlug",
  handleBlogEntryGetPublishedBySlug,
  BlogEntryGetPublishedBySlugPayloadSchema
);

// Register comments actions
registerAction(
  "cms.comments.create",
  handleCommentsCreate,
  CommentsCreatePayloadSchema
);

registerAction(
  "cms.comments.listForEntry",
  handleCommentsListForEntry,
  CommentsListForEntryPayloadSchema
);

export { handleBlogEntryCreate, handleBlogEntryRead, handleBlogEntryListPublished, handleBlogEntryGetPublishedBySlug, handleCommentsCreate, handleCommentsListForEntry };

