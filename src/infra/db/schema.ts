import { sql } from "drizzle-orm";
import {
  index,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const cmsSchema = pgSchema("cms");

export const globalContentTemplates = cmsSchema.table(
  "global_content_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").unique().notNull(),
    fieldsSchema: jsonb("fields_schema").notNull(),
    description: text("description"),
  },
);

export const contentTypes = cmsSchema.table(
  "content_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    templateKey: text("template_key")
      .references(() => globalContentTemplates.key)
      .notNull(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    routeSegment: text("route_segment").notNull(),
    config: jsonb("config"),
  },
  (table) => ({
    workspaceRouteSegmentUnique: uniqueIndex(
      "content_types_workspace_route_segment_unique",
    ).on(table.workspaceId, table.routeSegment),
  }),
);

export const contentEntries = cmsSchema.table("content_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  contentTypeId: uuid("content_type_id")
    .references(() => contentTypes.id)
    .notNull(),
  documentId: uuid("document_id"),
  data: jsonb("data").notNull(),
  status: text("status").default("draft").notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const contentDirectories = cmsSchema.table(
  "content_directories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    parentId: text("parent_id"),
    name: text("name").notNull(),
    pathSegment: text("path_segment").notNull(),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    workspaceCreatedAtIdx: index(
      "content_directories_workspace_created_at_idx",
    ).on(table.workspaceId, table.createdAt),
    workspaceRootPathSegmentUnique: uniqueIndex(
      "content_directories_workspace_root_path_segment_unique",
    )
      .on(table.workspaceId, table.pathSegment)
      .where(sql`${table.parentId} is null`),
    workspaceParentPathSegmentUnique: uniqueIndex(
      "content_directories_workspace_parent_path_segment_unique",
    )
      .on(table.workspaceId, table.parentId, table.pathSegment)
      .where(sql`${table.parentId} is not null`),
  }),
);

export const cmsComments = cmsSchema.table(
  "comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    entryId: uuid("entry_id")
      .references(() => contentEntries.id)
      .notNull(),
    parentId: uuid("parent_id"),
    userId: uuid("user_id"),
    displayName: text("display_name"),
    content: text("content").notNull(),
    status: text("status").default("pending").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    workspaceEntryCreatedIdx: index("comments_workspace_entry_created_idx").on(
      table.workspaceId,
      table.entryId,
      table.createdAt,
    ),
    parentIdx: index("comments_parent_idx").on(table.parentId),
  }),
);
