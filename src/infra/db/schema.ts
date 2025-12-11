import { pgSchema, uuid, text, jsonb, timestamp } from "drizzle-orm/pg-core";

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
