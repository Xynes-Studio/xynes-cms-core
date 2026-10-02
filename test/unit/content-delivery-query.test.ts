import { describe, expect, it } from "bun:test";
import { ContentDeliveryDirectoryPayloadSchema } from "../../src/actions/schemas/content-delivery";
import {
  buildDeliveryEntryQuery,
  buildDeliveryListQuery,
} from "../../src/infra/db/repositories/content-delivery.repository";

const id = "11111111-1111-4111-8111-111111111111";
describe("bounded folder SQL projection", () => {
  it("selects only bounded summaries with no body, full snapshot, current data or count", () => {
    const query = buildDeliveryListQuery({
      ...ContentDeliveryDirectoryPayloadSchema.parse({
        directoryId: id,
        limit: 100,
        offset: 10000,
        search: "literal %_'",
        sortBy: "title",
      }),
      workspaceId: id,
    }).toSQL();
    const projection = query.sql.split(" from ")[0] ?? "";
    expect(projection).not.toMatch(/\bbody\b|\bdata\b|count\s*\(/i);
    expect(projection).not.toMatch(/"published_snapshot"\s*[,)]/);
    expect(query.sql).toContain("published_snapshot_digest");
    expect(query.sql).toContain("sha256");
    expect(query.sql).toContain('collate "C"');
    expect(query.sql).not.toContain("literal");
    expect(query.params).toContain("%literal \\%\\_'%");
    expect(query.params.slice(-2)).toEqual([101, 10000]);
  });
});

describe("bounded detail SQL projection", () => {
  it("fetches only publication and availability fields, even for id-only requests", () => {
    const query = buildDeliveryEntryQuery({
      workspaceId: id,
      entryId: id,
      fields: ["id"],
    }).toSQL();
    const projection = query.sql.split(" from ")[0] ?? "";
    expect(projection).not.toMatch(
      /"data"|"created_by"|"updated_by"|"publication_failure"/,
    );
    expect(projection).toContain('"published_snapshot"');
    expect(query.sql).toContain("sha256");
    expect(query.params.at(-1)).toBe(1);
  });
});
