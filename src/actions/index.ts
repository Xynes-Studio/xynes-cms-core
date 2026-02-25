import {
  BlogEntryUpdateMetaPayloadSchema,
  handleBlogEntryUpdateMeta,
} from "./handlers/blog-entry-update-meta.handler";
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
import {
  ContentCreatePayloadSchema,
  handleContentCreate,
} from "./handlers/content-create.handler";
import {
  ContentDirectoriesCreatePayloadSchema,
  ContentDirectoriesListForWorkspacePayloadSchema,
  handleContentDirectoriesCreate,
  handleContentDirectoriesListForWorkspace,
} from "./handlers/content-directories.handler";
import {
  ContentGetPublishedBySlugPayloadSchema,
  ContentListPublishedPayloadSchema,
  handleContentGetPublishedBySlug,
  handleContentListPublished,
} from "./handlers/content-published.handler";
import {
  ContentTypeEnsureDefaultsPayloadSchema,
  handleContentTypeEnsureDefaults,
} from "./handlers/content-type-ensure-defaults.handler";
import {
  ContentTypesListForWorkspacePayloadSchema,
  handleContentTypesListForWorkspace,
} from "./handlers/content-types-list-for-workspace.handler";
import {
  TemplatesListGlobalPayloadSchema,
  handleTemplatesListGlobal,
} from "./handlers/templates-list-global.handler";
/**
 * Action Registration Module.
 * Registers all CMS action handlers on import.
 */
import { registerAction } from "./registry";

registerAction(
  "cms.content.create",
  handleContentCreate,
  ContentCreatePayloadSchema,
);

registerAction(
  "cms.content.listPublished",
  handleContentListPublished,
  ContentListPublishedPayloadSchema,
);

registerAction(
  "cms.content.getPublishedBySlug",
  handleContentGetPublishedBySlug,
  ContentGetPublishedBySlugPayloadSchema,
);

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

registerAction(
  "cms.blog_entry.updateMeta",
  handleBlogEntryUpdateMeta,
  BlogEntryUpdateMetaPayloadSchema,
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

// Register CMS metadata actions (read-only)
registerAction(
  "cms.templates.listGlobal",
  handleTemplatesListGlobal,
  TemplatesListGlobalPayloadSchema,
);

registerAction(
  "cms.content_types.listForWorkspace",
  handleContentTypesListForWorkspace,
  ContentTypesListForWorkspacePayloadSchema,
);

// Register CMS content type management actions
registerAction(
  "cms.content_types.ensureDefaults",
  handleContentTypeEnsureDefaults,
  ContentTypeEnsureDefaultsPayloadSchema,
);

registerAction(
  "cms.content_directories.listForWorkspace",
  handleContentDirectoriesListForWorkspace,
  ContentDirectoriesListForWorkspacePayloadSchema,
);

registerAction(
  "cms.content_directories.create",
  handleContentDirectoriesCreate,
  ContentDirectoriesCreatePayloadSchema,
);

export {
  handleBlogEntryCreate,
  handleBlogEntryRead,
  handleBlogEntryListPublished,
  handleBlogEntryGetPublishedBySlug,
  handleBlogEntryListAdmin,
  handleBlogEntryUpdateMeta,
  handleCommentsCreate,
  handleCommentsListForEntry,
  handleTemplatesListGlobal,
  handleContentTypesListForWorkspace,
  handleContentTypeEnsureDefaults,
  handleContentDirectoriesListForWorkspace,
  handleContentDirectoriesCreate,
  handleContentListPublished,
  handleContentGetPublishedBySlug,
};
