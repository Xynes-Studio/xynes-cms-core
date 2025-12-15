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
  ProgramGetPublishedBySlugPayloadSchema,
  ProgramListPublishedPayloadSchema,
  handleProgramCreate,
  handleProgramGetPublishedBySlug,
  handleProgramListPublished,
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

registerAction(
  "cms.program.listPublished",
  handleProgramListPublished,
  ProgramListPublishedPayloadSchema,
);

registerAction(
  "cms.program.getPublishedBySlug",
  handleProgramGetPublishedBySlug,
  ProgramGetPublishedBySlugPayloadSchema,
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
  handleProgramListPublished,
  handleProgramGetPublishedBySlug,
  handleEventCreate,
  handleCommentsCreate,
  handleCommentsListForEntry,
};
