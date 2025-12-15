import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  contentTypes,
  globalContentTemplates,
} from "../../src/infra/db/schema";

describe("CMS-13 program/event migration", () => {
  let sql: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle>;

  beforeAll(() => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required for DB-backed tests");
    }
    sql = postgres(databaseUrl, { max: 1 });
    db = drizzle(sql);
  });

  afterAll(async () => {
    await sql.end();
  });

  it("should have global templates for program and event", async () => {
    const program = await db
      .select()
      .from(globalContentTemplates)
      .where(eq(globalContentTemplates.key, "program"));

    const event = await db
      .select()
      .from(globalContentTemplates)
      .where(eq(globalContentTemplates.key, "event"));

    expect(program.length).toBe(1);
    expect(program[0].key).toBe("program");
    expect(event.length).toBe(1);
    expect(event[0].key).toBe("event");
  }, 15000);

  it("should backfill program/event types for a workspace that has blog_post", async () => {
    const testWorkspaceId = crypto.randomUUID();

    await db
      .insert(globalContentTemplates)
      .values({
        key: "blog_post",
        fieldsSchema: {
          slug: { type: "string", required: true },
          title: { type: "string", required: true },
        },
        description: "Blog Post Template",
      })
      .onConflictDoNothing();

    await db.insert(contentTypes).values({
      workspaceId: testWorkspaceId,
      templateKey: "blog_post",
      name: "Blog Post",
      slug: "blog-post",
      config: {},
    });

    const migrationPath = join(
      process.cwd(),
      "drizzle",
      "0003_silent_aurora.sql",
    );
    const migrationSql = readFileSync(migrationPath, "utf8");
    const statements = migrationSql
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);

    for (const statement of statements) {
      await sql.unsafe(statement);
    }

    const programTypes = await db
      .select()
      .from(contentTypes)
      .where(
        and(
          eq(contentTypes.workspaceId, testWorkspaceId),
          eq(contentTypes.templateKey, "program"),
        ),
      );

    const eventTypes = await db
      .select()
      .from(contentTypes)
      .where(
        and(
          eq(contentTypes.workspaceId, testWorkspaceId),
          eq(contentTypes.templateKey, "event"),
        ),
      );

    expect(programTypes.length).toBeGreaterThan(0);
    expect(eventTypes.length).toBeGreaterThan(0);

    await db
      .delete(contentTypes)
      .where(eq(contentTypes.workspaceId, testWorkspaceId));
  }, 15000);
});
