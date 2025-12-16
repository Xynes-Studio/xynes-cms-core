import {
  BlogEntryCreatePayloadSchema,
  BlogEntryGetPublishedBySlugPayloadSchema,
  BlogEntryListAdminPayloadSchema,
  BlogEntryListPublishedPayloadSchema,
  BlogEntryReadPayloadSchema,
  handleBlogEntryCreate,
  handleBlogEntryGetPublishedBySlug,
  handleBlogEntryListAdmin,
  handleBlogEntryListPublished,
  handleBlogEntryRead,
} from "./handlers/blog-entry.handler";
import {
  CommentsCreatePayloadSchema,
  handleCommentsCreate,
} from "./handlers/comments-create.handler";
import {
  CommentsListForEntryPayloadSchema,
  handleCommentsListForEntry,
} from "./handlers/comments-list.handler";
/**
 * Action Registration Module.
 * Registers all CMS action handlers on import.
 */
import { registerAction } from "./registry";

// Register blog entry actions
registerAction(
  "cms.blog_entry.create",
  handleBlogEntryCreate,
  BlogEntryCreatePayloadSchema,
);

registerAction(
  "cms.blog_entry.read",
  handleBlogEntryRead,
  BlogEntryReadPayloadSchema,
);

registerAction(
  "cms.blog_entry.listPublished",
  handleBlogEntryListPublished,
  BlogEntryListPublishedPayloadSchema,
);

registerAction(
  "cms.blog_entry.getPublishedBySlug",
  handleBlogEntryGetPublishedBySlug,
  BlogEntryGetPublishedBySlugPayloadSchema,
);

registerAction(
  "cms.blog_entry.listAdmin",
  handleBlogEntryListAdmin,
  BlogEntryListAdminPayloadSchema,
);

// Register comments actions
registerAction(
  "cms.comments.create",
  handleCommentsCreate,
  CommentsCreatePayloadSchema,
);

registerAction(
  "cms.comments.listForEntry",
  handleCommentsListForEntry,
  CommentsListForEntryPayloadSchema,
);

export {
  handleBlogEntryCreate,
  handleBlogEntryRead,
  handleBlogEntryListPublished,
  handleBlogEntryGetPublishedBySlug,
  handleBlogEntryListAdmin,
  handleCommentsCreate,
  handleCommentsListForEntry,
};
