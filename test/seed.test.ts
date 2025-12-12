import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, and } from "drizzle-orm";
import { globalContentTemplates, contentTypes } from "../src/infra/db/schema";
import { config } from "../src/infra/config";
import {
    runSeed,
    BLOG_POST_TEMPLATE_KEY,
    BLOG_POST_CONTENT_TYPE_SLUG,
} from "../src/infra/db/seeders";

describe("Seed Script", () => {
    let sql: ReturnType<typeof postgres>;
    let db: ReturnType<typeof drizzle>;
    const testWorkspaceId = crypto.randomUUID();

    beforeAll(() => {
        if (!config.databaseUrl) {
            throw new Error("DATABASE_URL is not set for tests");
        }
        sql = postgres(config.databaseUrl, { max: 1 });
        db = drizzle(sql);
    });

    afterAll(async () => {
        // Cleanup: Remove test data
        await db.delete(contentTypes).where(eq(contentTypes.workspaceId, testWorkspaceId));
        await sql.end();
    });

    test("should seed blog_post template and content type", async () => {
        await runSeed(db, testWorkspaceId);

        const templates = await db
            .select()
            .from(globalContentTemplates)
            .where(eq(globalContentTemplates.key, BLOG_POST_TEMPLATE_KEY));

        expect(templates.length).toBe(1);
        expect(templates[0].key).toBe(BLOG_POST_TEMPLATE_KEY);

        const types = await db
            .select()
            .from(contentTypes)
            .where(
                and(
                    eq(contentTypes.workspaceId, testWorkspaceId),
                    eq(contentTypes.slug, BLOG_POST_CONTENT_TYPE_SLUG)
                )
            );

        expect(types.length).toBe(1);
        expect(types[0].name).toBe("Blog Post");
    }, 15000);

    test("running seed twice should not create duplicates", async () => {
        await runSeed(db, testWorkspaceId);

        const templates = await db
            .select()
            .from(globalContentTemplates)
            .where(eq(globalContentTemplates.key, BLOG_POST_TEMPLATE_KEY));

        expect(templates.length).toBe(1);

        const types = await db
            .select()
            .from(contentTypes)
            .where(
                and(
                    eq(contentTypes.workspaceId, testWorkspaceId),
                    eq(contentTypes.slug, BLOG_POST_CONTENT_TYPE_SLUG)
                )
            );

        expect(types.length).toBe(1);
    }, 15000);
});
