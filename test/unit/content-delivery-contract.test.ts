import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { z } from "zod";
import {
  ContentDeliveryDirectoryPayloadSchema,
  ContentDeliveryEntryPayloadSchema,
  DELIVERY_DETAIL_FIELDS,
  DELIVERY_SUMMARY_FIELDS,
} from "../../src/actions/schemas/content-delivery";

const id = "11111111-1111-4111-8111-111111111111";
const metadata = z
  .object({
    operations: z.object({
      directory: z.object({
        fields: z.array(z.string()),
        sortBy: z.array(z.string()),
        sortDirection: z.array(z.string()),
        defaultSortBy: z.string(),
        defaultSortDirection: z.string(),
        searchMaxLength: z.number(),
        limit: z.object({
          min: z.number(),
          max: z.number(),
          default: z.number(),
        }),
        offset: z.object({
          min: z.number(),
          max: z.number(),
          default: z.number(),
        }),
      }),
      entry: z.object({ fields: z.array(z.string()) }),
    }),
    fieldsMaxLength: z.number(),
  })
  .parse(
    JSON.parse(
      readFileSync("test/fixtures/cms-delivery/contract.v1.json", "utf8"),
    ),
  );

describe("A1 delivery request contract", () => {
  it("matches actual A1 defaults and closed field/sort sets", () => {
    const directory = metadata.operations.directory;
    expect({
      directoryId: id,
      sortBy: directory.defaultSortBy,
      sortDirection: directory.defaultSortDirection,
      limit: directory.limit.default,
      offset: directory.offset.default,
      fields: directory.fields,
    }).toEqual(
      ContentDeliveryDirectoryPayloadSchema.parse({ directoryId: id }),
    );
    expect(directory.fields).toEqual([...DELIVERY_SUMMARY_FIELDS]);
    expect(metadata.operations.entry.fields).toEqual([
      ...DELIVERY_DETAIL_FIELDS,
    ]);
    expect(metadata.operations.entry.fields).toEqual(
      ContentDeliveryEntryPayloadSchema.parse({ entryId: id }).fields,
    );
    for (const sortBy of directory.sortBy)
      for (const sortDirection of directory.sortDirection)
        expect(
          ContentDeliveryDirectoryPayloadSchema.safeParse({
            directoryId: id,
            sortBy,
            sortDirection,
          }).success,
        ).toBe(true);
  });
  it("enforces each real contract bound on numeric internal payloads", () => {
    const bounds = metadata.operations.directory;
    for (const key of ["limit", "offset"] as const) {
      for (const value of [bounds[key].min, bounds[key].max])
        expect(
          ContentDeliveryDirectoryPayloadSchema.safeParse({
            directoryId: id,
            [key]: value,
          }).success,
        ).toBe(true);
      for (const value of [
        bounds[key].min - 1,
        bounds[key].max + 1,
        1.5,
        "20",
        true,
        [],
        null,
      ])
        expect(
          ContentDeliveryDirectoryPayloadSchema.safeParse({
            directoryId: id,
            [key]: value,
          }).success,
        ).toBe(false);
    }
    expect(
      ContentDeliveryDirectoryPayloadSchema.parse({
        directoryId: id,
        search: "  Published  ",
      }).search,
    ).toBe("Published");
    expect(
      ContentDeliveryDirectoryPayloadSchema.safeParse({
        directoryId: id,
        search: "a".repeat(bounds.searchMaxLength),
      }).success,
    ).toBe(true);
    for (const search of [
      " ",
      "a".repeat(bounds.searchMaxLength + 1),
      ["a", "b"],
    ])
      expect(
        ContentDeliveryDirectoryPayloadSchema.safeParse({
          directoryId: id,
          search,
        }).success,
      ).toBe(false);
  });
  it("requires exact folder/entry UUID context and rejects unsafe or unknown options", () => {
    for (const directoryId of [
      undefined,
      null,
      "root",
      "",
      "not-a-uuid",
      [id, id],
    ])
      expect(
        ContentDeliveryDirectoryPayloadSchema.safeParse({ directoryId })
          .success,
      ).toBe(false);
    for (const extra of [
      { workspaceId: id },
      { status: "draft" },
      { preview: true },
      { html: true },
      { sortBy: "updatedAt" },
      { sortDirection: "descending" },
    ])
      expect(
        ContentDeliveryDirectoryPayloadSchema.safeParse({
          directoryId: id,
          ...extra,
        }).success,
      ).toBe(false);
    for (const entryId of [undefined, null, "not-a-uuid", [id]])
      expect(
        ContentDeliveryEntryPayloadSchema.safeParse({ entryId }).success,
      ).toBe(false);
    expect(
      ContentDeliveryEntryPayloadSchema.safeParse({
        entryId: id,
        directoryId: id,
      }).success,
    ).toBe(false);
  });
  it("accepts trimmed CSV while retaining id and never admitting body into a list", () => {
    expect(
      ContentDeliveryDirectoryPayloadSchema.parse({
        directoryId: id,
        fields: " tags, title ",
      }).fields,
    ).toEqual(["id", "tags", "title"]);
    expect(
      ContentDeliveryEntryPayloadSchema.parse({ entryId: id, fields: "body" })
        .fields,
    ).toEqual(["id", "body"]);
    for (const fields of [
      "",
      " ",
      "id,",
      ",title",
      "id,id",
      "title, title",
      "body",
      "data",
      "createdBy",
      "__proto__",
      "id".repeat(metadata.fieldsMaxLength),
      ["title"],
    ])
      expect(
        ContentDeliveryDirectoryPayloadSchema.safeParse({
          directoryId: id,
          fields,
        }).success,
      ).toBe(false);
    for (const fields of ["id,body,body", "html", "title,,body", "workspaceId"])
      expect(
        ContentDeliveryEntryPayloadSchema.safeParse({ entryId: id, fields })
          .success,
      ).toBe(false);
  });
});
