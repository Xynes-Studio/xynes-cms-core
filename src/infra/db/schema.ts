import { pgSchema, uuid, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";

export const cmsSchema = pgSchema("cms");

export const globalContentTemplates = cmsSchema.table("global_content_templates", {
	id: uuid("id").primaryKey().defaultRandom(),
	key: text("key").unique().notNull(),
	fieldsSchema: jsonb("fields_schema").notNull(),
	description: text("description"),
});

export const contentTypes = cmsSchema.table("content_types", {
	id: uuid("id").primaryKey().defaultRandom(),
	workspaceId: uuid("workspace_id").notNull(),
	templateKey: text("template_key")
		.references(() => globalContentTemplates.key)
		.notNull(),
	name: text("name").notNull(),
	slug: text("slug").notNull(),
	config: jsonb("config"),
});

export const contentEntries = cmsSchema.table("content_entries", {
	id: uuid("id").primaryKey().defaultRandom(),
	workspaceId: uuid("workspace_id").notNull(),
	contentTypeId: uuid("content_type_id")
		.references(() => contentTypes.id)
		.notNull(),
	documentId: uuid("document_id"),
	data: jsonb("data").notNull(),
	status: text("status").default("draft").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

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
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => ({
		workspaceEntryCreatedIdx: index("comments_workspace_entry_created_idx").on(
			table.workspaceId,
			table.entryId,
			table.createdAt
		),
		parentIdx: index("comments_parent_idx").on(table.parentId),
	})
);
