import { describe, test, expect } from "bun:test";
import { db } from "../src/infra/db";
import { globalContentTemplates, contentTypes, contentEntries } from "../src/infra/db/schema";
import { eq } from "drizzle-orm";

describe("CMS Core Tables", () => {
    test("should create template, type, and entry", async () => {
        // 1. Create Template
        const templateKey = `test_template_${Date.now()}`;
        const [template] = await db.insert(globalContentTemplates).values({
            key: templateKey,
            fieldsSchema: { title: "string" },
            description: "Test template description"
        }).returning();
        
        expect(template).toBeDefined();
        expect(template.key).toBe(templateKey);

        // 2. Create Content Type
        const workspaceId = crypto.randomUUID();
        const [contentType] = await db.insert(contentTypes).values({
            workspaceId,
            templateKey: template.key,
            name: "Blog Post",
            slug: "blog-post",
            config: { version: 1 }
        }).returning();

        expect(contentType).toBeDefined();
        expect(contentType.templateKey).toBe(template.key);
        
        // 3. Create Content Entry
        const [entry] = await db.insert(contentEntries).values({
            workspaceId,
            contentTypeId: contentType.id,
            data: { title: "Hello World" },
            status: "published"
        }).returning();

        expect(entry).toBeDefined();
        expect(entry.contentTypeId).toBe(contentType.id);
        expect(entry.status).toBe("published");
        expect(entry.data).toEqual({ title: "Hello World" });
    }, 15000);
});
