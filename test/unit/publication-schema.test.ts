import { describe, expect, it } from "bun:test";
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as schema from "../../src/infra/db/schema";

describe("publication schema compatibility", () => {
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
