import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, and } from "drizzle-orm";
import { globalContentTemplates, contentTypes } from "../src/infra/db/schema";
import {
    runSeed,
    BLOG_POST_TEMPLATE_KEY,
    BLOG_POST_CONTENT_TYPE_SLUG,
    PROGRAM_TEMPLATE_KEY,
    PROGRAM_CONTENT_TYPE_SLUG,
    EVENT_TEMPLATE_KEY,
    EVENT_CONTENT_TYPE_SLUG,
} from "../src/infra/db/seeders";

describe("Seed Script", () => {
    let sql: ReturnType<typeof postgres>;
    let db: ReturnType<typeof drizzle>;
    const testWorkspaceId = crypto.randomUUID();

    beforeAll(() => {
        const databaseUrl = process.env.DATABASE_URL;
        if (!databaseUrl) {
            throw new Error("DATABASE_URL is required for DB-backed tests");
        }
        sql = postgres(databaseUrl, { max: 1 });
        db = drizzle(sql);
    });

    afterAll(async () => {
        // Cleanup: Remove test data
        await db.delete(contentTypes).where(eq(contentTypes.workspaceId, testWorkspaceId));
        await sql.end();
    });

    test("should seed blog_post/program/event templates and content types", async () => {
        await runSeed(db, testWorkspaceId);

        const blogTemplates = await db
            .select()
            .from(globalContentTemplates)
            .where(eq(globalContentTemplates.key, BLOG_POST_TEMPLATE_KEY));

        expect(blogTemplates.length).toBe(1);
        expect(blogTemplates[0].key).toBe(BLOG_POST_TEMPLATE_KEY);

        const programTemplates = await db
            .select()
            .from(globalContentTemplates)
            .where(eq(globalContentTemplates.key, PROGRAM_TEMPLATE_KEY));

        expect(programTemplates.length).toBe(1);
        expect(programTemplates[0].key).toBe(PROGRAM_TEMPLATE_KEY);

        const eventTemplates = await db
            .select()
            .from(globalContentTemplates)
            .where(eq(globalContentTemplates.key, EVENT_TEMPLATE_KEY));

        expect(eventTemplates.length).toBe(1);
        expect(eventTemplates[0].key).toBe(EVENT_TEMPLATE_KEY);

        const blogTypes = await db
            .select()
            .from(contentTypes)
            .where(
                and(
                    eq(contentTypes.workspaceId, testWorkspaceId),
                    eq(contentTypes.slug, BLOG_POST_CONTENT_TYPE_SLUG)
                )
            );

        expect(blogTypes.length).toBe(1);
        expect(blogTypes[0].name).toBe("Blog Post");

        const programTypes = await db
            .select()
            .from(contentTypes)
            .where(
                and(
                    eq(contentTypes.workspaceId, testWorkspaceId),
                    eq(contentTypes.slug, PROGRAM_CONTENT_TYPE_SLUG)
                )
            );

        expect(programTypes.length).toBe(1);
        expect(programTypes[0].name).toBe("Program");

        const eventTypes = await db
            .select()
            .from(contentTypes)
            .where(
                and(
                    eq(contentTypes.workspaceId, testWorkspaceId),
                    eq(contentTypes.slug, EVENT_CONTENT_TYPE_SLUG)
                )
            );

        expect(eventTypes.length).toBe(1);
        expect(eventTypes[0].name).toBe("Event");
    }, 60000);

    test("running seed twice should not create duplicates", async () => {
        await runSeed(db, testWorkspaceId);

        const templates = await db
            .select()
            .from(globalContentTemplates)
            .where(eq(globalContentTemplates.key, BLOG_POST_TEMPLATE_KEY));

        expect(templates.length).toBe(1);

        const blogTypes = await db
            .select()
            .from(contentTypes)
            .where(
                and(
                    eq(contentTypes.workspaceId, testWorkspaceId),
                    eq(contentTypes.slug, BLOG_POST_CONTENT_TYPE_SLUG)
                )
            );

        expect(blogTypes.length).toBe(1);

        const programTypes = await db
            .select()
            .from(contentTypes)
            .where(
                and(
                    eq(contentTypes.workspaceId, testWorkspaceId),
                    eq(contentTypes.slug, PROGRAM_CONTENT_TYPE_SLUG)
                )
            );

        expect(programTypes.length).toBe(1);

        const eventTypes = await db
            .select()
            .from(contentTypes)
            .where(
                and(
                    eq(contentTypes.workspaceId, testWorkspaceId),
                    eq(contentTypes.slug, EVENT_CONTENT_TYPE_SLUG)
                )
            );

        expect(eventTypes.length).toBe(1);
    }, 60000);
});
