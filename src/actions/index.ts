import {
  BlogEntryCreatePayloadSchema,
  BlogEntryGetPublishedBySlugPayloadSchema,
  BlogEntryListPublishedPayloadSchema,
  BlogEntryReadPayloadSchema,
  handleBlogEntryCreate,
  handleBlogEntryGetPublishedBySlug,
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
import {
  EventCreatePayloadSchema,
  handleEventCreate,
} from "./handlers/event.handler";
import {
  ProgramCreatePayloadSchema,
  handleProgramCreate,
} from "./handlers/program.handler";
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

// Register program/event actions
registerAction(
  "cms.program.create",
  handleProgramCreate,
  ProgramCreatePayloadSchema,
);

registerAction("cms.event.create", handleEventCreate, EventCreatePayloadSchema);

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
  handleProgramCreate,
  handleEventCreate,
  handleCommentsCreate,
  handleCommentsListForEntry,
};
