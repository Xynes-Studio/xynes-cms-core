import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as schema from "../../src/infra/db/schema";

describe("publication schema compatibility", () => {
  it("adds a nullable validation digest with an additive migration and delivery indexes", () => {
    const column = getTableConfig(schema.contentEntries).columns.find(
      (column) => column.name === "published_snapshot_digest",
    );
    expect(column?.getSQLType()).toBe("text");
    expect(column?.notNull).toBe(false);
    expect(column?.default).toBeUndefined();
    const path = "drizzle/0009_cms_publication_validation.sql";
    expect(existsSync(path)).toBe(true);
    const migration = readFileSync(path, "utf8");
    expect(migration).toContain(
      'ADD COLUMN IF NOT EXISTS "published_snapshot_digest" text',
    );
    expect(migration).toContain("CREATE INDEX IF NOT EXISTS");
    expect(migration).not.toMatch(/\b(DROP|DELETE|UPDATE|TRUNCATE)\b/i);
  });
  it("adds only nullable publication columns and preserves all CMS table/FK metadata", () => {
    const entries = getTableConfig(schema.contentEntries);
    for (const name of [
      "published_snapshot",
      "scheduled_publication_failure",
    ]) {
      const column = entries.columns.find((column) => column.name === name);
      expect(column?.getSQLType()).toBe("jsonb");
      expect(column?.notNull).toBe(false);
      expect(column?.default).toBeUndefined();
    }
    for (const table of Object.values(schema)) {
      if (!is(table, PgTable)) continue;
      const config = getTableConfig(table);
      expect(config.schema === "cms" || config.schema === "identity").toBe(
        true,
      );
      expect(config.columns.some((column) => column.primary)).toBe(true);
      for (const foreignKey of config.foreignKeys) {
        const reference = foreignKey.reference();
        expect(reference.columns.length).toBe(reference.foreignColumns.length);
        expect(reference.columns.length).toBeGreaterThan(0);
      }
    }
  });
});
